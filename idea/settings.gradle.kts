import org.jetbrains.intellij.platform.gradle.extensions.intellijPlatform

rootProject.name = "acpira"

pluginManagement {
    plugins {
        // IntelliJ Platform 2026.1 ships Kotlin 2.3 metadata; the compiler must be on the same line
        id("org.jetbrains.kotlin.jvm") version "2.3.21"
    }
}

plugins {
    id("org.jetbrains.intellij.platform.settings") version "2.18.1"
}

@Suppress("UnstableApiUsage")
dependencyResolutionManagement {
    repositories {
        mavenCentral()
        intellijPlatform {
            defaultRepositories()
        }
    }
}
