plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.intellij.platform")
}

group = "com.github.hotic.acpira"
version = providers.gradleProperty("pluginVersion").getOrElse("0.0.1")

kotlin {
    jvmToolchain(21)
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // IntelliJ IDEA is one unified distribution since 2025.3 (no more IC / IU). The installer form is required:
        // the SDK archive (useInstaller = false) ships without the JCEF native components
        intellijIdea(providers.gradleProperty("platformVersion"))
    }
}

tasks {
    runIde {
        // A sandbox launched from the terminal opens the project given as an argument (or none); trusting it up front keeps
        // startup activities from waiting behind the trust dialog
        systemProperty("idea.trust.all.projects", "true")
        providers.gradleProperty("runIdeProject").orNull?.let { args = listOf(it) }
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "com.github.hotic.acpira"
        name = "Acpira"
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            // No untilBuild: open-ended compatibility (the recommended default since 2024.3)
            untilBuild = provider { null }
        }
    }
}
