plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.sunhub.community"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.sunhub.community"
        minSdk = 26
        targetSdk = 36
        versionCode = 10
        versionName = "0.5.3"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            buildConfigField("String", "API_URL", "\"${providers.gradleProperty("sunhubApiUrl").getOrElse("http://10.0.2.2:4100")}\"")
            // Temporary HTTPS preview tunnels do not carry server-sent events.
            buildConfigField("boolean", "POLL_EVENTS", (providers.gradleProperty("sunhubEventPolling").orNull == "true").toString())
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "API_URL", "\"${providers.gradleProperty("sunhubApiUrl").getOrElse("https://api.example.invalid")}\"")
            buildConfigField("boolean", "POLL_EVENTS", "false")
        }
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.10.01"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("net.java.dev.jna:jna:5.17.0@aar")
    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.3.0")
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    implementation("androidx.media3:media3-ui:1.8.0")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.10.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    androidTestImplementation("androidx.test:runner:1.7.0")
}

// Rust is built separately for both ABIs by build-rust.sh, including generated Kotlin bindings.
tasks.named("preBuild") {
    doFirst {
        check(listOf("arm64-v8a", "x86_64").all { file("src/main/jniLibs/$it/libsunhub_mobile_core.so").exists() }) {
            "Build the Rust core first: ./build-rust.sh (see apps/android/README.md)."
        }
    }
}
