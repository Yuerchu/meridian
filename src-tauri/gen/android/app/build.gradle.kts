import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "cn.yuxiaoqiu.meridian"

    // The sherpa-onnx libraries for offline voice input are copied into
    // src/main/jniLibs/<abi>/ by sherpa-onnx-sys's build script (from 1.13.8),
    // beside Tauri's libmeridian_lib.so, with a .sherpa-onnx-version stamp so a
    // version change re-copies them. There is no second jniLibs source
    // directory any more: with one, the same library could arrive twice and
    // AGP refuses to merge duplicates.
    defaultConfig {
        // Remote access dials a desktop on the LAN -- `http://192.168.1.5:8787`
        // -- and Android blocks cleartext by default, which would make the
        // feature work in debug and fail in every shipped build.
        //
        // A `networkSecurityConfig` allowing only private ranges would be the
        // narrower answer and is not available: `domain-config` matches
        // hostnames, not CIDR, and the address is whatever the user's router
        // handed out. So it is permitted globally, and the boundary is the
        // bearer token instead -- which `listen_guard` refuses to let be short.
        // Tailscale is the answer for anyone who wants the transport encrypted
        // as well; it moves the problem to a layer that can actually solve it.
        manifestPlaceholders["usesCleartextTraffic"] = "true"
        applicationId = "cn.yuxiaoqiu.meridian"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    val keystorePath = System.getenv("ANDROID_KEYSTORE_FILE")
    val hasReleaseKeystore = keystorePath != null && file(keystorePath).exists()
    if (hasReleaseKeystore) {
        signingConfigs {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            // No silent debug-signing fallback: a debug-signed "release" APK
            // can't be upgraded later and must never be published. Without a
            // keystore the APK is left unsigned so it cannot be mistaken for
            // a releasable artifact (opt back in with ANDROID_ALLOW_DEBUG_SIGNING=true
            // for local testing).
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else if (System.getenv("ANDROID_ALLOW_DEBUG_SIGNING") == "true") {
                signingConfigs.getByName("debug")
            } else {
                null
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.documentfile:documentfile:1.1.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")