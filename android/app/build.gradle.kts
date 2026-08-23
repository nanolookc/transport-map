plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "uk.hrebeni.transit"
    compileSdk = 37

    defaultConfig {
        applicationId = "uk.hrebeni.transit"
        minSdk = 27
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "DEFAULT_API_BASE_URL", "\"https://transit.hrebeni.uk\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    val composeStylesVersion = "1.12.0-beta01"

    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation(platform("androidx.compose:compose-bom:2026.06.01"))
    implementation("androidx.compose.ui:ui:$composeStylesVersion")
    implementation("androidx.compose.ui:ui-tooling-preview:$composeStylesVersion")
    implementation("androidx.compose.foundation:foundation:$composeStylesVersion")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.material3:material3:1.5.0-alpha25")
    debugImplementation("androidx.compose.ui:ui-tooling:$composeStylesVersion")

    implementation("org.maplibre.gl:android-sdk:13.4.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
