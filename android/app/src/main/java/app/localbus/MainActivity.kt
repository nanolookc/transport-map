package uk.hrebeni.transit

import android.os.Bundle
import android.graphics.Color as AndroidColor
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.core.animateDecay
import androidx.compose.animation.core.FloatExponentialDecaySpec
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculateCentroidSize
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.outlined.DirectionsBus
import androidx.compose.material.icons.outlined.DirectionsBike
import androidx.compose.material.icons.outlined.Accessible
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.input.pointer.util.addPointerInputChange
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import androidx.lifecycle.viewmodel.compose.viewModel
import java.time.Instant
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.roundToInt

private const val DEBUG_MODE = false

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { TransportTheme { TransportApp() } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TransportApp(viewModel: TransitViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    var panel by remember { mutableStateOf<Panel?>(null) }
    var displayedVehicle by remember { mutableStateOf<Vehicle?>(null) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    LaunchedEffect(state.selectedVehicle) {
        state.selectedVehicle?.let { displayedVehicle = it }
    }

    Box(Modifier.fillMaxSize()) {
        TransitMap(state, viewModel::selectStop, viewModel::selectVehicle)
        Column(Modifier.statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
            if (state.favorites.isNotEmpty()) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    val allFavoritesActive = state.favorites.isNotEmpty() && state.selectedRoutes.isNotEmpty() && state.favorites.all(state.selectedRoutes::contains)
                    FavoritePill("Favorites", all = true, active = allFavoritesActive) { viewModel.applyFavoriteRoutes() }
                    state.favorites.forEach { id ->
                        val label = state.snapshot.routes.firstOrNull { it.id == id }?.shortName ?: id.toString()
                        FavoritePill(label, active = id in state.selectedRoutes) { viewModel.toggleFavoriteRouteVisibility(id) }
                    }
                }
            }
        }
        AnimatedVisibility(
            visible = state.selectedVehicle != null,
            modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(start = 16.dp, end = 16.dp, bottom = 144.dp),
            enter = fadeIn(tween(160)) + slideInVertically(tween(160)) { it / 10 },
            exit = fadeOut(tween(130)) + slideOutVertically(tween(130)) { it / 10 },
        ) {
            displayedVehicle?.let { vehicle ->
                val routeLabel = state.snapshot.routes.firstOrNull { it.id == vehicle.routeId }?.shortName ?: vehicle.routeId.toString()
                VehicleCard(vehicle, routeLabel, onClose = { viewModel.selectVehicle(null) })
            }
        }
        UpdateControl(
            state = state,
            onRefresh = viewModel::refreshVehicles,
            modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end = 16.dp, bottom = 80.dp),
        )
        Row(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            FloatingAction(icon = Icons.Filled.Map, label = "Map", active = true) { panel = null; viewModel.resetMap() }
            FloatingAction(icon = Icons.Outlined.FilterList, label = "Routes") { panel = Panel.ROUTES }
            FloatingAction(icon = Icons.Outlined.Favorite, label = "Favorites") { panel = Panel.FAVORITES }
        }
    }
    when {
        state.selectedStop != null -> ModalBottomSheet(onDismissRequest = { viewModel.selectStop(null) }, sheetState = sheetState) { StopSheet(state, viewModel) }
        panel != null -> ModalBottomSheet(onDismissRequest = { panel = null }, sheetState = sheetState) {
            when (panel) {
                Panel.ROUTES -> RoutesSheet(state, viewModel, false)
                Panel.FAVORITES -> RoutesSheet(state, viewModel, true)
                null -> Unit
            }
        }
    }
}

@Composable
private fun UpdateControl(state: TransitUiState, onRefresh: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainer.copy(alpha = 0.96f),
        tonalElevation = 3.dp,
    ) {
        Row(Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                state.error ?: lastUpdatedText(state),
                style = MaterialTheme.typography.labelSmall,
                color = if (state.error == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            FilledIconButton(onClick = onRefresh, enabled = !state.refreshing, modifier = Modifier.padding(start = 6.dp).size(40.dp)) {
                if (state.refreshing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Icon(Icons.Filled.Refresh, contentDescription = "Refresh vehicles")
            }
        }
    }
}

private enum class Panel { ROUTES, FAVORITES }

@Composable
private fun FavoritePill(label: String, all: Boolean = false, active: Boolean = false, onClick: () -> Unit) {
    Surface(
        shape = MaterialTheme.shapes.small,
        color = if (active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHighest,
        contentColor = if (active) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Row(Modifier.padding(horizontal = 11.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            if (all) Icon(Icons.Outlined.Star, null, Modifier.size(15.dp))
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun FloatingAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, active: Boolean = false, onClick: () -> Unit) {
    Surface(shape = MaterialTheme.shapes.large, color = if (active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.clickable(onClick = onClick)) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(19.dp))
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun RoutesSheet(state: TransitUiState, viewModel: TransitViewModel, favoritesOnly: Boolean) {
    var query by remember { mutableStateOf("") }
    val visibleRoutes = state.snapshot.routes.filter { route ->
        (!favoritesOnly || route.id in state.favorites) && (query.isBlank() || route.shortName.contains(query, true) || route.longName.contains(query, true))
    }
    Column(Modifier.fillMaxWidth().fillMaxHeight(0.92f).imePadding().padding(horizontal = 20.dp).padding(bottom = 24.dp)) {
        Text(if (favoritesOnly) "Favorite routes" else "Routes", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(if (state.selectedRoutes.isEmpty()) "All routes are visible" else "${state.selectedRoutes.size} selected", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        TextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
            placeholder = { Text("Search routes") },
            leadingIcon = { Icon(Icons.Outlined.Search, null) },
            singleLine = true,
            shape = MaterialTheme.shapes.large,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
            ),
        )
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = state.direction == null, onClick = { viewModel.setDirection(null) }, label = { Text("Both") })
            FilterChip(selected = state.direction == 0, onClick = { viewModel.setDirection(0) }, label = { Text("Way") })
            FilterChip(selected = state.direction == 1, onClick = { viewModel.setDirection(1) }, label = { Text("Roundway") })
            if (state.selectedRoutes.isNotEmpty()) TextButton(onClick = viewModel::clearRoutes) { Text("Show all") }
        }
        LazyColumn(Modifier.weight(1f).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            items(visibleRoutes, key = { it.id }) { route -> RouteItem(route, route.id in state.selectedRoutes || state.selectedRoutes.isEmpty(), route.id in state.favorites, { viewModel.toggleRoute(route.id) }, { viewModel.toggleFavorite(route.id) }) }
            if (visibleRoutes.isEmpty()) item { Text("No matching routes.", Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
private fun RouteItem(route: Route, selected: Boolean, favorite: Boolean, onToggle: () -> Unit, onFavorite: () -> Unit) {
    Surface(shape = MaterialTheme.shapes.medium, color = if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.52f) else Color.Transparent, modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle)) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(color = routeColor(route.color, MaterialTheme.colorScheme.primary), shape = MaterialTheme.shapes.small) { Text(route.shortName, Modifier.padding(horizontal = 10.dp, vertical = 9.dp), color = Color.White, fontWeight = FontWeight.ExtraBold) }
            Column(Modifier.padding(start = 12.dp).weight(1f)) {
                Text(route.longName.ifBlank { route.description.ifBlank { "Route ${route.shortName}" } }, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
                if (route.description.isNotBlank()) Text(route.description, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onFavorite) { Icon(if (favorite) Icons.Outlined.Star else Icons.Outlined.StarBorder, if (favorite) "Remove favorite" else "Add favorite", tint = if (favorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
private fun VehicleCard(vehicle: Vehicle, routeLabel: String, onClose: () -> Unit) {
    val dark = isSystemInDarkTheme()
    val titleColor = if (dark) Color.White else MaterialTheme.colorScheme.onSurface
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.96f), contentColor = titleColor)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Outlined.DirectionsBus, null, tint = MaterialTheme.colorScheme.primary)
            Column(Modifier.padding(start = 12.dp).weight(1f)) {
                Text("Vehicle ${vehicle.label}", fontWeight = FontWeight.Bold, color = titleColor)
                Text("Route $routeLabel · ${vehicle.speed.roundToInt()} km/h · ${relativeTime(vehicle.timestamp)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.padding(top = 5.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    VehicleAccessIcon(Icons.Outlined.DirectionsBike, "Bike access", vehicle.bikeAccessible)
                    VehicleAccessIcon(Icons.Outlined.Accessible, "Wheelchair access", vehicle.wheelchairAccessible)
                }
            }
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Close vehicle") }
        }
    }
}

@Composable
private fun VehicleAccessIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String) {
    val available = value.equals("yes", true) || value == "1" || value.equals("true", true)
    Icon(
        icon,
        contentDescription = "$label: ${value.ifBlank { "unknown" }}",
        modifier = Modifier.size(18.dp),
        tint = if (available) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.38f),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StopSheet(state: TransitUiState, viewModel: TransitViewModel) {
    val stop = state.selectedStop ?: return
    var routeInfo by remember(stop.id, state.snapshot.trips, state.snapshot.stopTimes) { mutableStateOf<StopRouteInfo?>(null) }
    LaunchedEffect(stop.id, state.snapshot.trips, state.snapshot.stopTimes) {
        routeInfo = withContext(Dispatchers.Default) { stopRouteInfo(state.snapshot, stop.id) }
    }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 32.dp)) {
        Text(stop.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (DEBUG_MODE) {
            Text("ID ${stop.id}${stop.code.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${"%.5f".format(stop.latitude)}, ${"%.5f".format(stop.longitude)} · ${stopLocationType(stop.locationType)}", Modifier.padding(top = 4.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (state.arrivals == null || state.timeline == null) {
            Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text("Loading stop details…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text("Open routes", Modifier.padding(top = 20.dp), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        routeInfo?.let { info ->
            CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides 0.dp) {
                FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    FilterChip(selected = info.routes.all { it in state.selectedRoutes } && state.selectedRoutes.isNotEmpty(), onClick = { viewModel.showOnlyRoutes(info.routes) }, label = { Text("All") })
                    info.routes.forEach { routeId ->
                        val route = state.snapshot.routes.firstOrNull { it.id == routeId }
                        FilterChip(selected = state.selectedRoutes.isEmpty() || routeId in state.selectedRoutes, onClick = { viewModel.toggleRoute(routeId) }, label = { Text(route?.shortName ?: routeId.toString()) })
                    }
                }
            }
            Text("${info.routes.size} routes · ${info.scheduledTrips} scheduled trips", Modifier.padding(top = 6.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text("Live arrivals", Modifier.padding(top = 22.dp), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        val arrivals = state.arrivals
        if (arrivals == null) Text("Loading live ETA…", Modifier.padding(vertical = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        else if (arrivals.arrivals.isEmpty()) Text("No live vehicles currently matched to this stop.", Modifier.padding(vertical = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        else Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { arrivals.arrivals.take(8).forEach { ArrivalRow(it) } }
        Text("Timeline", Modifier.padding(top = 22.dp), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { state.timeline?.takeIf { it.canGoOlder }?.let { viewModel.changeTimeline(it.offset + 1) } }, enabled = state.timeline?.canGoOlder == true) { Icon(Icons.Filled.ChevronLeft, "Show earlier day") }
            IconButton(onClick = { state.timeline?.takeIf { it.canGoNewer }?.let { viewModel.changeTimeline(it.offset - 1) } }, enabled = state.timeline?.canGoNewer == true) { Icon(Icons.Filled.ChevronRight, "Show later day") }
        }
        TimelineChart(state.timeline, state.selectedRoutes)
    }
}

@Composable
private fun ArrivalRow(arrival: LiveArrival) {
    val routeTint = routeColor(arrival.routeColor.orEmpty(), MaterialTheme.colorScheme.primary)
    val tintAlpha = if (isSystemInDarkTheme()) 0.28f else 0.14f
    Surface(shape = MaterialTheme.shapes.medium, color = routeTint.copy(alpha = tintAlpha), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(color = routeTint, shape = MaterialTheme.shapes.small) { Text(arrival.routeName ?: arrival.routeId.toString(), Modifier.padding(horizontal = 8.dp, vertical = 5.dp), color = Color.White, fontWeight = FontWeight.Bold) }
            Column(Modifier.padding(start = 10.dp).weight(1f)) {
                Text(liveStatus(arrival.status), style = MaterialTheme.typography.bodySmall)
                Text(listOfNotNull(arrival.distanceMeters?.let(::distance), arrival.confidence).joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(eta(arrival.etaSeconds, arrival.status), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun TimelineChart(timeline: StopTimeline?, selectedRoutes: Set<Long>) {
    if (timeline == null) {
        Text("Loading stop history…", Modifier.padding(vertical = 16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    if (timeline.days.isEmpty()) {
        Text("No history for these days.", Modifier.padding(vertical = 16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    val allRouteIds = remember(timeline) { timeline.routes.map { it.id }.toSet() }
    val allowed = if (selectedRoutes.isEmpty()) allRouteIds else selectedRoutes
    val points = remember(timeline, allowed) {
        timeline.days.flatMapIndexed { dayIndex, day ->
            day.points.mapNotNull { point ->
                if (point.routeId !in allowed) return@mapNotNull null
                val time = runCatching { Instant.parse(point.timestamp).atZone(ZoneId.systemDefault()) }.getOrNull()
                    ?: return@mapNotNull null
                PreparedTimelinePoint(dayIndex, point, time.hour * 60f + time.minute + time.second / 60f)
            }
        }
    }
    if (points.isEmpty()) {
        Text("No arrivals for the selected routes in this period.", Modifier.padding(vertical = 16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    val primaryColor = MaterialTheme.colorScheme.primary
    val colors = remember(timeline, primaryColor) {
        timeline.routes.associate { it.id to routeColor(it.color.orEmpty(), primaryColor) }
    }
    val labelColor = MaterialTheme.colorScheme.onSurfaceVariant
    val weekendColor = if (isSystemInDarkTheme()) Color(0xFFFB7185) else Color(0xFFF43F5E)
    val nowColor = MaterialTheme.colorScheme.primary
    val range = remember(points) { timelineRange(points) }
    var selectedPoint by remember(timeline.offset, selectedRoutes) { mutableStateOf<SelectedTimelinePoint?>(null) }
    var zoom by remember(timeline.offset) { mutableFloatStateOf(1f) }
    var clock by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val timelineHeight = 1536f
    val density = LocalDensity.current
    val timelineHeightPx = with(density) { timelineHeight.dp.toPx() }
    var viewportWidth by remember { mutableIntStateOf(0) }
    var viewportHeight by remember { mutableIntStateOf(0) }
    var scrollOffset by remember(timeline.offset) { mutableFloatStateOf(0f) }
    val flingScope = rememberCoroutineScope()
    var flingJob by remember { mutableStateOf<Job?>(null) }
    fun maxScroll(scale: Float = zoom) = (timelineHeightPx * scale - viewportHeight).coerceAtLeast(0f)
    val currentZoom by rememberUpdatedState(zoom)
    val currentScrollOffset by rememberUpdatedState(scrollOffset)
    val pointRadius = with(density) { 8.dp.toPx() }
    val predictedStroke = remember(density) { Stroke(with(density) { 3.dp.toPx() }) }
    val hourLabelPaint = remember(labelColor) {
        android.graphics.Paint().apply {
            color = labelColor.toArgb()
            textSize = with(density) { 12.dp.toPx() }
        }
    }
    LaunchedEffect(Unit) { while (true) { delay(10_000); clock = System.currentTimeMillis() } }
    LaunchedEffect(selectedPoint) {
        if (selectedPoint != null) {
            delay(3_500)
            selectedPoint = null
        }
    }
    LaunchedEffect(timeline.offset, range.min, range.max) {
        withFrameNanos { }
        val nowRatio = ((minuteOfDay(clock) - range.min) / range.span).coerceIn(0f, 1f)
        scrollOffset = (maxScroll() * nowRatio - with(density) { 96.dp.toPx() }).coerceIn(0f, maxScroll())
    }
    Column(Modifier.padding(top = 8.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 36.dp)) {
            timeline.days.forEach { day ->
                val weekend = isWeekend(day.date)
                Text(
                    if (day.today) "Today" else day.date.takeLast(5),
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (weekend) weekendColor else labelColor,
                    fontWeight = if (weekend) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1,
                )
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(384.dp)
                .clipToBounds()
                .onSizeChanged { size -> viewportWidth = size.width; viewportHeight = size.height },
        ) {
        Column(
            Modifier
                .fillMaxSize()
                .pointerInput(timeline.offset, range) {
                    awaitEachGesture {
                        val velocityTracker = VelocityTracker()
                        val down = awaitFirstDown(requireUnconsumed = false)
                        flingJob?.cancel()
                        velocityTracker.addPointerInputChange(down)
                        var accumulatedZoom = 1f
                        var accumulatedPan = Offset.Zero
                        var pastTouchSlop = false
                        var multiTouch = false
                        val touchSlop = viewConfiguration.touchSlop

                        do {
                            val event = awaitPointerEvent()
                            if (event.changes.count { it.pressed } > 1) multiTouch = true
                            if (!multiTouch) {
                                event.changes.firstOrNull { it.id == down.id }
                                    ?.let(velocityTracker::addPointerInputChange)
                            }
                            val zoomChange = event.calculateZoom()
                            val panChange = event.calculatePan()
                            if (!pastTouchSlop) {
                                accumulatedZoom *= zoomChange
                                accumulatedPan += panChange
                                val zoomMotion = abs(1f - accumulatedZoom) * event.calculateCentroidSize(useCurrent = false)
                                if (zoomMotion > touchSlop || accumulatedPan.getDistance() > touchSlop) pastTouchSlop = true
                            }
                            if (pastTouchSlop) {
                                val centroid = event.calculateCentroid(useCurrent = false)
                                if (zoomChange != 1f || panChange != Offset.Zero) {
                                    val previousZoom = currentZoom
                                    val nextZoom = (previousZoom * zoomChange).coerceIn(1f, 6f)
                                    val focalContentY = (currentScrollOffset + centroid.y) / previousZoom
                                    zoom = nextZoom
                                    scrollOffset = (focalContentY * nextZoom - centroid.y - panChange.y)
                                        .coerceIn(0f, maxScroll(nextZoom))
                                }
                                event.changes.filter { it.positionChanged() }.forEach { it.consume() }
                            }
                        } while (event.changes.any { it.pressed })

                        if (!multiTouch && pastTouchSlop) {
                            val velocityY = velocityTracker.calculateVelocity().y
                            if (abs(velocityY) > 100f) {
                                flingJob = flingScope.launch {
                                    animateDecay(
                                        initialValue = currentScrollOffset,
                                        initialVelocity = -velocityY,
                                        animationSpec = FloatExponentialDecaySpec(frictionMultiplier = 1.5f),
                                    ) { value, _ ->
                                        scrollOffset = value.coerceIn(0f, maxScroll(currentZoom))
                                    }
                                }
                            }
                        }
                    }
                },
        ) {
        Canvas(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight()
                .padding(top = 8.dp)
                .pointerInput(points, range, timeline.offset) {
                    detectTapGestures { tap ->
                        val left = 34.dp.toPx()
                        val col = (size.width - left) / timeline.days.size
                        val nearest = points.map { point ->
                            val x = left + col * (point.dayIndex + .5f)
                            val y = timelineHeightPx * currentZoom * ((point.minutes - range.min) / range.span) - currentScrollOffset
                            SelectedTimelinePoint(point.dayIndex, point.point, x, y)
                        }.minByOrNull { candidate -> (candidate.x - tap.x) * (candidate.x - tap.x) + (candidate.y - tap.y) * (candidate.y - tap.y) }
                        selectedPoint = nearest?.takeIf { candidate -> (candidate.x - tap.x) * (candidate.x - tap.x) + (candidate.y - tap.y) * (candidate.y - tap.y) <= 22.dp.toPx() * 22.dp.toPx() }
                    }
                },
        ) {
            val left = 34.dp.toPx()
            val col = (size.width - left) / timeline.days.size
            for (hour in (range.min.toInt() / 60)..(range.max.toInt() / 60)) {
                val minute = hour * 60f
                val y = timelineHeightPx * zoom * ((minute - range.min) / range.span) - scrollOffset
                drawLine(labelColor.copy(alpha = .2f), Offset(left, y), Offset(size.width, y), 1f)
                drawContext.canvas.nativeCanvas.drawText("${hour.toString().padStart(2, '0')}:00", 0f, y + 10f, hourLabelPaint)
            }
            val nowY = timelineHeightPx * zoom * ((minuteOfDay(clock) - range.min) / range.span) - scrollOffset
            if (nowY in 0f..size.height) drawLine(nowColor.copy(alpha = .7f), Offset(left, nowY), Offset(size.width, nowY), 3f)
            points.forEach { point ->
                val y = timelineHeightPx * zoom * ((point.minutes - range.min) / range.span) - scrollOffset
                if (y < -pointRadius || y > size.height + pointRadius) return@forEach
                val x = left + col * (point.dayIndex + .5f)
                val color = colors[point.point.routeId] ?: Color.Black
                if (point.point.predicted) drawCircle(color, pointRadius, Offset(x, y), style = predictedStroke) else drawCircle(color, pointRadius, Offset(x, y))
            }
        }
        }
        selectedPoint?.let { selected ->
            val route = timeline.routes.firstOrNull { it.id == selected.point.routeId }
            val time = runCatching { Instant.parse(selected.point.timestamp).atZone(ZoneId.systemDefault()).toLocalTime().toString().take(5) }.getOrDefault(selected.point.timestamp)
            val tooltipWidth = with(density) { 206.dp.toPx() }
            val inset = with(density) { 4.dp.toPx() }
            val tooltipHeight = with(density) { 40.dp.toPx() }
            val x = (selected.x - tooltipWidth / 2).coerceIn(inset, (viewportWidth - tooltipWidth - inset).coerceAtLeast(0f))
            val pointY = selected.y
            val below = pointY + with(density) { 14.dp.toPx() }
            val y = if (below + tooltipHeight <= with(density) { 380.dp.toPx() }) below else (pointY - tooltipHeight - with(density) { 14.dp.toPx() }).coerceAtLeast(inset)
            Surface(
                modifier = Modifier.offset { IntOffset(x.roundToInt(), y.roundToInt()) }.width(206.dp),
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surfaceContainerHighest.copy(alpha = .97f),
                tonalElevation = 4.dp,
            ) {
                Row(Modifier.padding(horizontal = 10.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(9.dp).background(colors[selected.point.routeId] ?: MaterialTheme.colorScheme.primary, MaterialTheme.shapes.extraSmall))
                    Text("${route?.shortName ?: selected.point.routeId} · ${if (timeline.days[selected.dayIndex].today) "Today" else timeline.days[selected.dayIndex].date} · ${if (selected.point.predicted) "Predicted " else ""}$time", Modifier.padding(start = 7.dp), style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
}

private data class StopRouteInfo(val routes: List<Long>, val scheduledTrips: Int)

private fun stopRouteInfo(snapshot: TransitSnapshot, stopId: Long): StopRouteInfo {
    val routesByTrip = snapshot.trips.associate { it.id to it.routeId }
    val stopTimes = snapshot.stopTimes.filter { it.stopId == stopId }
    return StopRouteInfo(stopTimes.mapNotNull { routesByTrip[it.tripId] }.distinct().sorted(), stopTimes.size)
}

private data class PreparedTimelinePoint(val dayIndex: Int, val point: TimelinePoint, val minutes: Float)
private data class SelectedTimelinePoint(val dayIndex: Int, val point: TimelinePoint, val x: Float, val y: Float)

private data class TimelineRange(val min: Float, val max: Float) { val span: Float get() = (max - min).coerceAtLeast(1f) }

private fun isWeekend(date: String): Boolean = runCatching {
    LocalDate.parse(date).dayOfWeek in setOf(DayOfWeek.SATURDAY, DayOfWeek.SUNDAY)
}.getOrDefault(false)

private fun timelineRange(points: List<PreparedTimelinePoint>): TimelineRange {
    val values = points.map { it.minutes }
    if (values.isEmpty()) return TimelineRange(0f, 1440f)
    val min = kotlin.math.floor((values.min() - 60f) / 15f).toFloat() * 15f
    val max = kotlin.math.ceil((values.max() + 60f) / 15f).toFloat() * 15f
    return TimelineRange(min.coerceAtLeast(0f), max.coerceAtMost(1440f))
}

private fun minuteOfDay(timeMillis: Long): Float = Instant.ofEpochMilli(timeMillis).atZone(ZoneId.systemDefault()).let { it.hour * 60f + it.minute + it.second / 60f }

private fun lastUpdatedText(state: TransitUiState): String = when {
    state.loading -> "Loading…"
    state.snapshot.fetchedAt == null -> "Waiting for data"
    else -> runCatching {
        "Updated " + DateTimeFormatter.ofPattern("HH:mm").format(Instant.parse(state.snapshot.fetchedAt).atZone(ZoneId.systemDefault()))
    }.getOrDefault("Updated")
}
private fun routeColor(raw: String, fallback: Color): Color = runCatching { Color(AndroidColor.parseColor(if (raw.startsWith("#")) raw else "#$raw")) }.getOrDefault(fallback)
private fun eta(seconds: Long?, status: String): String = if (status == "arriving") "Arriving" else when { seconds == null -> "No ETA"; seconds < 60 -> "<1 min"; else -> "${(seconds / 60.0).roundToInt()} min" }
private fun distance(meters: Double): String = if (meters < 1000) "${meters.roundToInt()} m" else "%.1f km".format(meters / 1000)
private fun liveStatus(status: String): String = when (status) { "waiting_at_terminal" -> "standing at terminal"; "stopped_on_route" -> "stopped"; "moving" -> "on the way"; "arriving" -> "arriving"; else -> status.replace('_', ' ') }
private fun stopLocationType(type: Int): String = when (type) { 0 -> "Stop"; 1 -> "Station"; else -> "Stop type $type" }
private fun relativeTime(value: String): String = runCatching {
    val seconds = java.time.Duration.between(Instant.parse(value), Instant.now()).seconds.coerceAtLeast(0)
    when { seconds < 60 -> "just now"; seconds < 3600 -> "${seconds / 60} min ago"; else -> "${seconds / 3600} h ago" }
}.getOrDefault(value)
