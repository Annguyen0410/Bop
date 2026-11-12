// Standalone project, deliberately NOT included by the product's settings.gradle.kts: this app exists
// only to post a notification under a package the hub observes, so the notification path can be
// exercised on a real device without a live account. Build with:
//   ./gradlew -p tools/notifier-fixture :app:assembleDebug
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "bop-notifier-fixture"
include(":app")
