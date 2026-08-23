package uk.hrebeni.transit

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class TransitUiState(
    val apiBaseUrl: String,
    val snapshot: TransitSnapshot = TransitSnapshot(),
    val selectedRoutes: Set<Long> = emptySet(),
    val favorites: Set<Long> = emptySet(),
    val direction: Int? = null,
    val selectedStop: Stop? = null,
    val selectedVehicle: Vehicle? = null,
    val arrivals: LiveArrivals? = null,
    val timeline: StopTimeline? = null,
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val error: String? = null,
)

class TransitViewModel(application: Application) : AndroidViewModel(application) {
    private val preferences = application.getSharedPreferences("transport_map", Context.MODE_PRIVATE)
    private val repository = TransitRepository()
    private var refreshJob: Job? = null
    private var stopJob: Job? = null
    private val _state = MutableStateFlow(
        TransitUiState(
            apiBaseUrl = BuildConfig.DEFAULT_API_BASE_URL,
            favorites = preferences.getStringSet("favorites", emptySet()).orEmpty().mapNotNull { it.toLongOrNull() }.toSet(),
        ),
    )
    val state = _state.asStateFlow()

    init { reloadAll() }

    fun reloadAll() {
        refreshJob?.cancel()
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            runCatching { repository.loadSnapshot(_state.value.apiBaseUrl) }
                .onSuccess { snapshot ->
                    _state.update { old ->
                        old.copy(snapshot = snapshot, loading = false, error = null,
                            selectedVehicle = old.selectedVehicle?.let { selected -> snapshot.vehicles.firstOrNull { it.id == selected.id } })
                    }
                    startVehicleRefresh()
                }
                .onFailure { error -> _state.update { it.copy(loading = false, error = error.message ?: "Could not load transport data") } }
        }
    }

    private fun startVehicleRefresh() {
        refreshJob?.cancel()
        refreshJob = viewModelScope.launch {
            while (isActive) {
                delay(20_000)
                runCatching { repository.loadVehicles(_state.value.apiBaseUrl) }.onSuccess { (vehicles, fetchedAt) ->
                    _state.update { old -> old.copy(snapshot = old.snapshot.copy(vehicles = vehicles, fetchedAt = fetchedAt), selectedVehicle = old.selectedVehicle?.let { selected -> vehicles.firstOrNull { it.id == selected.id } }) }
                }
            }
        }
    }

    fun refreshVehicles() = viewModelScope.launch {
        _state.update { it.copy(refreshing = true) }
        runCatching { repository.loadVehicles(_state.value.apiBaseUrl) }
            .onSuccess { (vehicles, fetchedAt) -> _state.update { old -> old.copy(refreshing = false, snapshot = old.snapshot.copy(vehicles = vehicles, fetchedAt = fetchedAt)) } }
            .onFailure { error -> _state.update { it.copy(refreshing = false, error = error.message ?: "Could not refresh vehicles") } }
    }

    fun toggleRoute(id: Long) = _state.update { state ->
        state.copy(selectedRoutes = state.selectedRoutes.toMutableSet().apply { if (!add(id)) remove(id) })
    }
    fun showOnlyRoutes(ids: Collection<Long>) = _state.update { it.copy(selectedRoutes = ids.toSet()) }
    fun clearRoutes() = _state.update { it.copy(selectedRoutes = emptySet()) }
    fun resetMap() = _state.update { it.copy(selectedRoutes = emptySet(), direction = null, selectedStop = null, selectedVehicle = null, arrivals = null, timeline = null) }
    fun setDirection(direction: Int?) = _state.update { it.copy(direction = direction) }
    fun toggleFavorite(id: Long) = _state.update { state ->
        val next = state.favorites.toMutableSet().apply { if (!add(id)) remove(id) }
        preferences.edit().putStringSet("favorites", next.map(Long::toString).toSet()).apply()
        state.copy(favorites = next)
    }
    /** Matches the web favourite strip: a route tap toggles it, starting from an all-routes view. */
    fun toggleFavoriteRouteVisibility(id: Long) = _state.update { state ->
        if (state.selectedRoutes.isEmpty()) state.copy(selectedRoutes = setOf(id))
        else state.copy(selectedRoutes = state.selectedRoutes.toMutableSet().apply { if (!add(id)) remove(id) })
    }

    /** Select all favourites, or return to all routes when they are already all selected. */
    fun applyFavoriteRoutes() = _state.update { state ->
        if (state.favorites.isEmpty()) return@update state
        when {
            state.selectedRoutes.isEmpty() -> state.copy(selectedRoutes = state.favorites)
            state.favorites.all(state.selectedRoutes::contains) -> state.copy(selectedRoutes = emptySet())
            else -> state.copy(selectedRoutes = state.selectedRoutes + state.favorites)
        }
    }

    fun selectVehicle(vehicle: Vehicle?) = _state.update { it.copy(selectedVehicle = vehicle, selectedStop = null, arrivals = null, timeline = null) }
    fun selectStop(stop: Stop?) {
        stopJob?.cancel()
        _state.update { it.copy(selectedStop = stop, selectedVehicle = null, arrivals = null, timeline = null) }
        if (stop != null) loadStop(stop.id, 0)
    }

    fun changeTimeline(offset: Int) {
        val stop = _state.value.selectedStop ?: return
        loadStop(stop.id, offset, arrivals = false)
    }

    private fun loadStop(stopId: Long, offset: Int, arrivals: Boolean = true) {
        stopJob?.cancel()
        stopJob = viewModelScope.launch {
            val base = _state.value.apiBaseUrl
            if (arrivals) launch { runCatching { repository.loadArrivals(base, stopId) }.onSuccess { result -> _state.update { it.copy(arrivals = result) } } }
            runCatching { repository.loadTimeline(base, stopId, offset) }
                .onSuccess { result -> _state.update { it.copy(timeline = result) } }
                .onFailure { error -> _state.update { it.copy(error = error.message ?: "Could not load stop history") } }
        }
    }

    override fun onCleared() {
        refreshJob?.cancel()
        stopJob?.cancel()
    }
}
