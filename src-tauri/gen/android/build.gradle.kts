buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        // 2.2 is the ceiling while Tauri's own Android projects (tauri 2.11.6 and the
        // dialog / notification / shell plugins, compiled from the cargo registry)
        // still write kotlinOptions { jvmTarget = "1.8" }: 2.3 made that an error
        // and fails their build scripts, 2.2 only warns. Measured 2026-09-25.
        // Tauri's dev branch has moved to compilerOptions; lift this with it.
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.21")
        classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:2.2.21")
        classpath("org.jetbrains.kotlin:kotlin-serialization:2.2.21")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register("clean").configure {
    delete("build")
}

