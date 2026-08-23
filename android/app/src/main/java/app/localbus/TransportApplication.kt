package uk.hrebeni.transit

import android.app.Application
import org.maplibre.android.MapLibre

class TransportApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        MapLibre.getInstance(this)
    }
}
