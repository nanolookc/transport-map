package uk.hrebeni.transit

import android.graphics.Color as AndroidColor
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.layers.PropertyFactory.circleColor
import org.maplibre.android.style.layers.PropertyFactory.circleOpacity
import org.maplibre.android.style.layers.PropertyFactory.circleRadius
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeColor
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeWidth
import org.maplibre.android.style.layers.PropertyFactory.lineCap
import org.maplibre.android.style.layers.PropertyFactory.lineColor
import org.maplibre.android.style.layers.PropertyFactory.lineJoin
import org.maplibre.android.style.layers.PropertyFactory.lineOpacity
import org.maplibre.android.style.layers.PropertyFactory.lineWidth
import org.maplibre.android.style.layers.PropertyFactory.iconAllowOverlap
import org.maplibre.android.style.layers.PropertyFactory.iconIgnorePlacement
import org.maplibre.android.style.layers.PropertyFactory.iconImage
import org.maplibre.android.style.layers.PropertyFactory.iconRotate
import org.maplibre.android.style.layers.Property.LINE_CAP_ROUND
import org.maplibre.android.style.layers.Property.LINE_JOIN_ROUND
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

@Composable
fun TransitMap(
    state: TransitUiState,
    onStopClick: (Stop) -> Unit,
    onVehicleClick: (Vehicle) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val dark = isSystemInDarkTheme()
    val colors = MaterialTheme.colorScheme
    val newestState by rememberUpdatedState(state)
    val newestStopClick by rememberUpdatedState(onStopClick)
    val newestVehicleClick by rememberUpdatedState(onVehicleClick)
    val bearingTracker = remember { VehicleBearingTracker() }
    val renderState = remember { MapRenderState() }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var style by remember { mutableStateOf<Style?>(null) }
    val mapView = remember(dark) {
        MapView(context, MapLibreMapOptions.createFromAttributes(context).camera(
            CameraPosition.Builder().target(LatLng(47.16, 27.58)).zoom(12.0).build(),
        ).compassEnabled(false).logoEnabled(false)).apply { onCreate(null) }
    }

    DisposableEffect(owner, mapView) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                Lifecycle.Event.ON_DESTROY -> mapView.onDestroy()
                else -> Unit
            }
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer); mapView.onDestroy() }
    }

    AndroidView(
        factory = {
            mapView.apply {
                getMapAsync { readyMap ->
                    map = readyMap
                    readyMap.uiSettings.apply {
                        isCompassEnabled = false
                        isLogoEnabled = false
                        isAttributionEnabled = true
                    }
                    readyMap.setStyle(if (dark) MAP_DARK else MAP_LIGHT) { readyStyle ->
                        style = readyStyle
                        addLayers(readyStyle, colors.secondary.toArgb())
                        render(readyStyle, newestState, dark, bearingTracker, renderState)
                    }
                    readyMap.addOnMapClickListener { point ->
                        val activeStyle = style ?: return@addOnMapClickListener false
                        val features = readyMap.queryRenderedFeatures(readyMap.projection.toScreenLocation(point), STOPS_LAYER, *VEHICLE_ARROW_LAYERS.toTypedArray())
                        val feature = features.firstOrNull() ?: return@addOnMapClickListener false
                        feature.properties()?.get("kind")?.asString?.let { kind ->
                            val id = feature.properties()?.get("id")?.asString?.toLongOrNull()
                            when (kind) {
                                "stop" -> newestState.snapshot.stops.firstOrNull { it.id == id }?.let(newestStopClick)
                                "vehicle" -> newestState.snapshot.vehicles.firstOrNull { it.id == id }?.let(newestVehicleClick)
                            }
                        }
                        activeStyle.isFullyLoaded
                    }
                }
            }
        },
        update = { if (style != null) render(style!!, state, dark, bearingTracker, renderState) },
        modifier = modifier.fillMaxSize(),
    )
}

private fun addLayers(style: Style, secondary: Int) {
    style.addSource(GeoJsonSource(STOPS_SOURCE, FeatureCollection.fromFeatures(emptyList())))
    style.addLayer(CircleLayer(STOPS_LAYER, STOPS_SOURCE).withProperties(circleRadius(5f), circleColor("#${Integer.toHexString(secondary).takeLast(6)}"), circleStrokeColor("#FFFFFF"), circleStrokeWidth(1.5f), circleOpacity(0.92f)))
    VEHICLE_BUCKETS.forEach { bucket ->
        style.addSource(GeoJsonSource(bucket.sourceId, FeatureCollection.fromFeatures(emptyList())))
        style.addImage(bucket.imageId, busArrowBitmap(bucket.color))
        style.addLayer(CircleLayer(bucket.circleLayerId, bucket.sourceId).withProperties(circleRadius(11f), circleColor(bucket.color), circleStrokeColor("#FFFFFF"), circleStrokeWidth(2.5f)))
        style.addLayer(SymbolLayer(bucket.arrowLayerId, bucket.sourceId).withProperties(iconImage(bucket.imageId), iconRotate(Expression.get("bearing")), iconAllowOverlap(true), iconIgnorePlacement(true)))
    }
}

private fun render(style: Style, state: TransitUiState, dark: Boolean, bearingTracker: VehicleBearingTracker, renderState: MapRenderState) {
    val selected = state.selectedRoutes
    val routeIds = if (selected.isEmpty()) state.snapshot.routes.map { it.id }.toSet() else selected
    val tripsByRoute = state.snapshot.trips.filter { it.routeId in routeIds && (state.direction == null || it.direction == state.direction) }.groupBy { it.routeId }
    val shapeById = state.snapshot.shapePoints.groupBy { it.shapeId }.mapValues { (_, points) -> points.sortedBy { it.sequence } }
    val routeById = state.snapshot.routes.associateBy { it.id }
    val routes = tripsByRoute.mapNotNull { (routeId, routeTrips) ->
        val features = routeTrips.distinctBy { it.direction }.mapNotNull { trip ->
            shapeById[trip.shapeId]?.takeIf { it.size > 1 }?.let { points ->
                Feature.fromGeometry(LineString.fromLngLats(points.map { Point.fromLngLat(it.longitude, it.latitude) }))
            }
        }
        routeId.takeIf { features.isNotEmpty() }?.let { it to features }
    }
    renderState.replaceRouteLayers(style, routes, routeById, dark)
    val tripRouteById = state.snapshot.trips.associate { it.id to it.routeId }
    val stopRouteIds = state.snapshot.stopTimes.groupBy { it.stopId }.mapValues { (_, times) -> times.mapNotNull { tripRouteById[it.tripId] }.toSet() }
    val stopFeatures = state.snapshot.stops.map { stop ->
        Feature.fromGeometry(Point.fromLngLat(stop.longitude, stop.latitude)).also { feature -> feature.addStringProperty("kind", "stop"); feature.addStringProperty("id", stop.id.toString()) }
    }
    val tripById = state.snapshot.trips.associateBy { it.id }
    val vehicleFeatures = state.snapshot.vehicles.filter { it.routeId in routeIds && it.latitude != null && it.longitude != null }.map { vehicle ->
        val routeBearing = vehicle.tripId?.let { tripById[it] }?.let { trip -> shapeById[trip.shapeId]?.let { shape -> bearingFromShape(vehicle.latitude!!, vehicle.longitude!!, shape) } }
        val bearing = routeBearing ?: bearingTracker.bearing(vehicle) ?: 0.0
        Feature.fromGeometry(Point.fromLngLat(vehicle.longitude!!, vehicle.latitude!!)).also { feature ->
            feature.addStringProperty("kind", "vehicle")
            feature.addStringProperty("id", vehicle.id.toString())
            feature.addNumberProperty("bearing", bearing)
            feature.addStringProperty("timestamp", vehicle.timestamp)
        }
    }
    (style.getSourceAs<GeoJsonSource>(STOPS_SOURCE))?.setGeoJson(FeatureCollection.fromFeatures(stopFeatures.filter { feature ->
        val stopId = feature.properties()?.get("id")?.asString?.toLongOrNull()
        selected.isEmpty() || (stopId != null && stopRouteIds[stopId]?.any(selected::contains) == true)
    }))
    VEHICLE_BUCKETS.forEach { bucket ->
        style.getSourceAs<GeoJsonSource>(bucket.sourceId)?.setGeoJson(FeatureCollection.fromFeatures(vehicleFeatures.filter { feature -> vehicleAgeColor(feature.properties()?.get("timestamp")?.asString.orEmpty()) == bucket.color }))
    }
}

/** Exact counterpart of the web app's normalizeHexColor() and ensureVisibleColor(). */
private fun visibleRouteColor(raw: String?, dark: Boolean): String {
    val fallback = if (dark) "#a0a0b0" else "#0f172a"
    val normalized = normalizeRouteHex(raw?.takeIf { it.isNotBlank() } ?: fallback) ?: return fallback
    val parsed = AndroidColor.parseColor(normalized)
    val (hue, initialSaturation, initialLightness) = rgbToHsl(parsed)
    var saturation = initialSaturation
    var lightness = initialLightness
    if (dark && lightness < 0.42f) {
        lightness = maxOf(lightness, 0.45f + lightness * 0.3f)
        if (saturation < 0.08f) saturation = 0.08f
    } else if (!dark && lightness > 0.85f) {
        saturation = minOf(saturation * 1.2f, 1f)
        lightness = minOf(lightness, 0.7f)
    } else return normalized
    return hslToHex(hue, saturation, lightness)
}

private fun normalizeRouteHex(value: String): String? {
    val raw = value.trim().removePrefix("#")
    return when {
        raw.matches(Regex("[0-9a-fA-F]{3}")) -> "#" + raw.lowercase().map { "$it$it" }.joinToString("")
        raw.matches(Regex("[0-9a-fA-F]{6}")) -> "#$raw".lowercase()
        else -> null
    }
}

private fun rgbToHsl(color: Int): Triple<Float, Float, Float> {
    val r = AndroidColor.red(color) / 255f
    val g = AndroidColor.green(color) / 255f
    val b = AndroidColor.blue(color) / 255f
    val max = maxOf(r, g, b)
    val min = minOf(r, g, b)
    val lightness = (max + min) / 2f
    if (max == min) return Triple(0f, 0f, lightness)
    val delta = max - min
    val saturation = if (lightness > .5f) delta / (2f - max - min) else delta / (max + min)
    val hue = when (max) {
        r -> ((g - b) / delta + if (g < b) 6f else 0f) / 6f
        g -> ((b - r) / delta + 2f) / 6f
        else -> ((r - g) / delta + 4f) / 6f
    }
    return Triple(hue * 360f, saturation, lightness)
}

private fun hslToHex(hue: Float, saturation: Float, lightness: Float): String {
    if (saturation == 0f) {
        val value = (lightness * 255).toInt().coerceIn(0, 255)
        return "#%02x%02x%02x".format(value, value, value)
    }
    val h = hue / 360f
    val q = if (lightness < .5f) lightness * (1 + saturation) else lightness + saturation - lightness * saturation
    val p = 2 * lightness - q
    fun channel(t: Float): Int {
        var value = t
        if (value < 0) value += 1f
        if (value > 1) value -= 1f
        val rgb = when {
            value < 1f / 6f -> p + (q - p) * 6f * value
            value < .5f -> q
            value < 2f / 3f -> p + (q - p) * (2f / 3f - value) * 6f
            else -> p
        }
        return (rgb * 255).toInt().coerceIn(0, 255)
    }
    return "#%02x%02x%02x".format(channel(h + 1f / 3f), channel(h), channel(h - 1f / 3f))
}

private data class VehiclePosition(val latitude: Double, val longitude: Double, val bearing: Double?)

private class VehicleBearingTracker {
    private val positions = mutableMapOf<Long, VehiclePosition>()
    fun bearing(vehicle: Vehicle): Double? {
        val latitude = vehicle.latitude ?: return null
        val longitude = vehicle.longitude ?: return null
        val previous = positions[vehicle.id]
        val nextBearing = if (previous != null && (previous.latitude != latitude || previous.longitude != longitude)) {
            bearing(previous.latitude, previous.longitude, latitude, longitude)
        } else previous?.bearing
        positions[vehicle.id] = VehiclePosition(latitude, longitude, nextBearing)
        return nextBearing
    }
}

private class MapRenderState {
    private val routeLayerIds = mutableListOf<String>()
    private val routeSourceIds = mutableListOf<String>()

    fun replaceRouteLayers(style: Style, routes: List<Pair<Long, List<Feature>>>, routeById: Map<Long, Route>, dark: Boolean) {
        routeLayerIds.forEach { layerId -> style.getLayer(layerId)?.let { style.removeLayer(layerId) } }
        routeSourceIds.forEach { sourceId -> style.getSourceAs<GeoJsonSource>(sourceId)?.let { style.removeSource(sourceId) } }
        routeLayerIds.clear()
        routeSourceIds.clear()
        routes.forEach { (routeId, features) ->
            val sourceId = "transit-route-source-$routeId"
            val layerId = "transit-route-layer-$routeId"
            val color = visibleRouteColor(routeById[routeId]?.color, dark)
            style.addSource(GeoJsonSource(sourceId, FeatureCollection.fromFeatures(features)))
            style.addLayerBelow(LineLayer(layerId, sourceId).withProperties(
                lineColor(color),
                lineWidth(4f), lineOpacity(0.9f), lineCap(LINE_CAP_ROUND), lineJoin(LINE_JOIN_ROUND),
            ), STOPS_LAYER)
            routeSourceIds += sourceId
            routeLayerIds += layerId
        }
    }
}

private fun bearingFromShape(latitude: Double, longitude: Double, points: List<ShapePoint>): Double? {
    if (points.size < 2) return null
    val latitudeRadians = Math.toRadians(latitude)
    val cosLatitude = kotlin.math.cos(latitudeRadians)
    val pointX = Math.toRadians(longitude) * cosLatitude
    val pointY = latitudeRadians
    var bestDistance = Double.POSITIVE_INFINITY
    var start: ShapePoint? = null
    var end: ShapePoint? = null
    points.zipWithNext().forEach { (first, second) ->
        val startX = Math.toRadians(first.longitude) * cosLatitude
        val startY = Math.toRadians(first.latitude)
        val endX = Math.toRadians(second.longitude) * cosLatitude
        val endY = Math.toRadians(second.latitude)
        val dx = endX - startX
        val dy = endY - startY
        val fraction = if (dx == 0.0 && dy == 0.0) 0.0 else (((pointX - startX) * dx + (pointY - startY) * dy) / (dx * dx + dy * dy)).coerceIn(0.0, 1.0)
        val distance = (pointX - (startX + fraction * dx)) * (pointX - (startX + fraction * dx)) + (pointY - (startY + fraction * dy)) * (pointY - (startY + fraction * dy))
        if (distance < bestDistance) { bestDistance = distance; start = first; end = second }
    }
    return if (start != null && end != null) bearing(start!!.latitude, start!!.longitude, end!!.latitude, end!!.longitude) else null
}

private fun bearing(fromLatitude: Double, fromLongitude: Double, toLatitude: Double, toLongitude: Double): Double {
    val firstLatitude = Math.toRadians(fromLatitude)
    val secondLatitude = Math.toRadians(toLatitude)
    val deltaLongitude = Math.toRadians(toLongitude - fromLongitude)
    val y = kotlin.math.sin(deltaLongitude) * kotlin.math.cos(secondLatitude)
    val x = kotlin.math.cos(firstLatitude) * kotlin.math.sin(secondLatitude) - kotlin.math.sin(firstLatitude) * kotlin.math.cos(secondLatitude) * kotlin.math.cos(deltaLongitude)
    return (Math.toDegrees(kotlin.math.atan2(y, x)) + 360.0) % 360.0
}

private fun vehicleAgeColor(timestamp: String): String {
    val minutes = runCatching { java.time.Duration.between(java.time.Instant.parse(timestamp), java.time.Instant.now()).toMinutes() }.getOrDefault(Long.MAX_VALUE)
    return when { minutes <= 2 -> "#16a34a"; minutes <= 15 -> "#facc15"; else -> "#dc2626" }
}

/** Inner directional mark; the round vehicle body is rendered by the CircleLayer. */
private fun busArrowBitmap(color: String): Bitmap {
    val bitmap = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = AndroidColor.parseColor(color); style = Paint.Style.FILL }
    val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = AndroidColor.WHITE; style = Paint.Style.STROKE; strokeWidth = 3f; strokeJoin = Paint.Join.ROUND }
    // Keep one outer marker circle, but make its directional mark immediately legible.
    val arrow = Path().apply { moveTo(16f, 2f); lineTo(26f, 25f); lineTo(16f, 21f); lineTo(6f, 25f); close() }
    canvas.drawPath(arrow, fill)
    canvas.drawPath(arrow, stroke)
    return bitmap
}

private const val MAP_LIGHT = "https://tiles.openfreemap.org/styles/positron"
private const val MAP_DARK = "https://tiles.openfreemap.org/styles/dark"
private const val STOPS_SOURCE = "transit-stops-source"
private const val STOPS_LAYER = "transit-stops-layer"

private data class VehicleBucket(val sourceId: String, val circleLayerId: String, val arrowLayerId: String, val imageId: String, val color: String)
private val VEHICLE_BUCKETS = listOf(
    VehicleBucket("transit-vehicles-fresh-source", "transit-vehicles-fresh-layer", "transit-vehicles-fresh-arrows", "transit-vehicle-fresh", "#16a34a"),
    VehicleBucket("transit-vehicles-recent-source", "transit-vehicles-recent-layer", "transit-vehicles-recent-arrows", "transit-vehicle-recent", "#facc15"),
    VehicleBucket("transit-vehicles-stale-source", "transit-vehicles-stale-layer", "transit-vehicles-stale-arrows", "transit-vehicle-stale", "#dc2626"),
)
private val VEHICLE_ARROW_LAYERS = VEHICLE_BUCKETS.flatMap { listOf(it.circleLayerId, it.arrowLayerId) }
