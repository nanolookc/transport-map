package uk.hrebeni.transit

data class Vehicle(
    val id: Long,
    val label: String,
    val latitude: Double?,
    val longitude: Double?,
    val timestamp: String,
    val speed: Double,
    val routeId: Long,
    val tripId: String?,
    val bikeAccessible: String,
    val wheelchairAccessible: String,
)

data class Route(
    val id: Long,
    val shortName: String,
    val longName: String,
    val color: String,
    val description: String,
)

data class Trip(
    val routeId: Long,
    val id: String,
    val direction: Int,
    val shapeId: String,
)

data class ShapePoint(val shapeId: String, val latitude: Double, val longitude: Double, val sequence: Int)

data class Stop(
    val id: Long,
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val locationType: Int,
    val code: String,
)

data class StopTime(val tripId: String, val stopId: Long)

data class LiveArrival(
    val vehicleId: Long,
    val routeId: Long,
    val routeName: String?,
    val routeColor: String?,
    val etaSeconds: Long?,
    val distanceMeters: Double?,
    val status: String,
    val confidence: String,
)

data class LiveArrivals(val fetchedAt: String?, val arrivals: List<LiveArrival>)

data class TimelineRoute(val id: Long, val shortName: String?, val color: String?)
data class TimelinePoint(val routeId: Long, val timestamp: String, val predicted: Boolean)
data class TimelineDay(val date: String, val today: Boolean, val points: List<TimelinePoint>)
data class StopTimeline(
    val routes: List<TimelineRoute>,
    val days: List<TimelineDay>,
    val offset: Int,
    val canGoOlder: Boolean,
    val canGoNewer: Boolean,
)

data class TransitSnapshot(
    val routes: List<Route> = emptyList(),
    val trips: List<Trip> = emptyList(),
    val shapePoints: List<ShapePoint> = emptyList(),
    val stops: List<Stop> = emptyList(),
    val stopTimes: List<StopTime> = emptyList(),
    val vehicles: List<Vehicle> = emptyList(),
    val fetchedAt: String? = null,
)
