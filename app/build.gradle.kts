import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

/**
 * Release signing is read from `keystore.properties` in the repository root, which is never
 * committed. Without that file the release build still assembles (unsigned), so CI and the local
 * build command keep working without secrets.
 */
val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.isFile) file.inputStream().use { load(it) }
}

android {
    namespace = "com.example.twoaccmess"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        // Debug keeps the original id so an existing install (and its signed-in web sessions) can be
        // updated in place; the release build type below publishes under its own, store-safe id.
        applicationId = "com.example.twoaccmess"
        minSdk = 24
        targetSdk = 37
        versionCode = 9
        versionName = "2.0-bop"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (keystoreProperties.isNotEmpty()) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            if (keystoreProperties.isNotEmpty()) signingConfig = signingConfigs.getByName("release")
            // Code and resource shrinking for the store build. Debug builds stay unshrunk so a stack
            // trace from a test phone still names the original lines.
            optimization {
                enable = true
            }
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
    }

    /**
     * English only. Bop's own strings are English, but every AndroidX library also ships its own
     * translations, so a phone set to Vietnamese (or any of the other 80 locales) showed library text
     * — autofill hints, dialog buttons — in that language. Filtering the locale list drops those
     * folders from the APK instead of leaving them to surprise the user.
     */
    androidResources {
        localeFilters += listOf("en")
    }
    packaging {
        resources {
            // Keeps the store build free of duplicate licence files from the Compose dependencies.
            excludes += setOf("META-INF/LICENSE*", "META-INF/*.kotlin_module")
        }
    }
}

/**
 * The debug build keeps the original application id so an existing install (and its signed-in web
 * sessions) upgrades in place. The release build publishes under its own id, which you should replace
 * with your own reverse-domain id before uploading: set `publishApplicationId` in gradle.properties
 * or pass -PpublishApplicationId=com.yourdomain.twoaccmess.
 */
val publishApplicationId = providers.gradleProperty("publishApplicationId").orNull ?: "com.twoaccmess.hub"

androidComponents {
    onVariants { variant ->
        if (variant.buildType == "release") variant.applicationId.set(publishApplicationId)
    }
}

dependencies {
    implementation(libs.androidx.webkit)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}