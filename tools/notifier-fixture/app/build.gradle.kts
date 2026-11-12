plugins {
    id("com.android.application") version "9.4.1"
}

android {
    namespace = "com.whatsapp"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        // Deliberately the package of a service the hub observes ([HubApps]). Installing this on a
        // throwaway emulator is what makes the real notification path testable: otherwise the alert
        // pipeline can only be fed by an actual WhatsApp account.
        applicationId = "com.whatsapp"
        minSdk = 28
        targetSdk = 34
        versionCode = 1
        versionName = "fixture"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
