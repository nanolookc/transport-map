package uk.hrebeni.transit

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class TransitRepository {
    suspend fun loadSnapshot(baseUrl: String): TransitSnapshot = withContext(Dispatchers.IO) {
        val root = baseUrl.trim().trimEnd('/')
        require(root.startsWith("http://") || root.startsWith("https://")) {
            "API URL must begin with http:// or https://"
        }
        val vehiclePayload = get(root, "/api/proxy/vehicles")
        TransitSnapshot(
            routes = array(get(root, "/api/proxy/routes")).map(::route).sortedWith(compareBy(naturalOrder()) { it.shortName }),
            trips = array(get(root, "/api/proxy/trips")).map(::trip),
            shapePoints = array(get(root, "/api/proxy/shapes")).map(::shapePoint),
            stops = array(get(root, "/api/proxy/stops")).map(::stop),
            stopTimes = array(get(root, "/api/proxy/stop_times")).map(::stopTime),
            vehicles = vehicles(vehiclePayload),
            fetchedAt = vehiclePayload.optString("fetchedAt").ifBlank { null },
        )
    }

    suspend fun loadVehicles(baseUrl: String): Pair<List<Vehicle>, String?> = withContext(Dispatchers.IO) {
        val payload = get(baseUrl.trim().trimEnd('/'), "/api/proxy/vehicles")
        vehicles(payload) to payload.optString("fetchedAt").ifBlank { null }
    }

    suspend fun loadArrivals(baseUrl: String, stopId: Long): LiveArrivals = withContext(Dispatchers.IO) {
        val json = get(baseUrl.trim().trimEnd('/'), "/api/live/stop/$stopId")
        LiveArrivals(
            fetchedAt = json.optString("fetchedAt").ifBlank { null },
            arrivals = array(json.optJSONArray("arrivals")).map { item ->
                LiveArrival(
                    vehicleId = item.optLong("vehicleId"), routeId = item.optLong("routeId"),
                    routeName = item.optString("routeShortName").ifBlank { null },
                    routeColor = item.optString("routeColor").ifBlank { null },
                    etaSeconds = if (item.isNull("etaSeconds")) null else item.optLong("etaSeconds"),
                    distanceMeters = if (item.isNull("distanceMeters")) null else item.optDouble("distanceMeters"),
                    status = item.optString("status"), confidence = item.optString("confidence"),
                )
            },
        )
    }

    suspend fun loadTimeline(baseUrl: String, stopId: Long, offset: Int): StopTimeline = withContext(Dispatchers.IO) {
        val json = get(baseUrl.trim().trimEnd('/'), "/api/analytics/stop/$stopId?offset=$offset")
        val window = json.optJSONObject("window") ?: JSONObject()
        StopTimeline(
            routes = array(json.optJSONArray("routes")).map { item ->
                TimelineRoute(item.optLong("routeId"), item.optString("routeShortName").ifBlank { null }, item.optString("routeColor").ifBlank { null })
            },
            days = array(json.optJSONArray("days")).map { day ->
                TimelineDay(day.optString("date"), day.optBoolean("isToday"), array(day.optJSONArray("points")).flatMap { group ->
                    strings(group.optJSONArray("timestamps")).map { timestamp -> TimelinePoint(group.optLong("routeId"), timestamp, group.optBoolean("predicted")) }
                })
            },
            offset = window.optInt("offset"), canGoOlder = window.optBoolean("canGoOlder"), canGoNewer = window.optBoolean("canGoNewer"),
        )
    }

    private fun get(baseUrl: String, path: String): JSONObject {
        val connection = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            connectTimeout = 12_000
            readTimeout = 20_000
            requestMethod = "GET"
            setRequestProperty("Accept", "application/json")
        }
        return try {
            val code = connection.responseCode
            val body = (if (code in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) error("API error $code")
            if (body.trimStart().startsWith("[")) JSONObject().put("items", JSONArray(body)) else JSONObject(body)
        } finally {
            connection.disconnect()
        }
    }

    private fun array(json: JSONObject): List<JSONObject> = array(json.optJSONArray("items"))

    private fun vehicles(json: JSONObject): List<Vehicle> = array(json.optJSONArray("vehicles") ?: json.optJSONArray("items")).map(::vehicle)
    private fun array(values: JSONArray?): List<JSONObject> = (0 until (values?.length() ?: 0)).mapNotNull { values?.optJSONObject(it) }
    private fun strings(values: JSONArray?): List<String> = (0 until (values?.length() ?: 0)).mapNotNull { index -> values?.optString(index)?.takeIf { it.isNotBlank() } }
    private fun route(j: JSONObject) = Route(j.optLong("route_id"), j.optString("route_short_name"), j.optString("route_long_name"), j.optString("route_color"), j.optString("route_desc"))
    private fun trip(j: JSONObject) = Trip(j.optLong("route_id"), j.optString("trip_id"), j.optInt("direction_id"), j.optString("shape_id"))
    private fun shapePoint(j: JSONObject) = ShapePoint(j.optString("shape_id"), j.optDouble("shape_pt_lat"), j.optDouble("shape_pt_lon"), j.optInt("shape_pt_sequence"))
    private fun stop(j: JSONObject) = Stop(j.optLong("stop_id"), j.optString("stop_name"), j.optDouble("stop_lat"), j.optDouble("stop_lon"), j.optInt("location_type"), j.optString("stop_code"))
    private fun stopTime(j: JSONObject) = StopTime(j.optString("trip_id"), j.optLong("stop_id"))
    private fun vehicle(j: JSONObject) = Vehicle(j.optLong("id"), j.optString("label"), j.optNullableDouble("latitude"), j.optNullableDouble("longitude"), j.optString("timestamp"), j.optDouble("speed"), j.optLong("route_id"), j.optString("trip_id").ifBlank { null }, j.optString("bike_accessible"), j.optString("wheelchair_accessible"))
}

private fun JSONObject.optNullableDouble(name: String): Double? = if (isNull(name)) null else optDouble(name)
