package com.example.twoaccmess.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFFD8F875), onPrimary = Color(0xFF211B38),
    secondary = Color(0xFFE3D9FF), tertiary = Color(0xFFFFDBCA),
    background = Color(0xFF14121C), onBackground = Color(0xFFF4EFFC),
    surface = Color(0xFF211D2B), onSurface = Color(0xFFF4EFFC), onSurfaceVariant = Color(0xFFBEB6CE),
    surfaceContainer = Color(0xFF282332), surfaceContainerHigh = Color(0xFF302A3C), surfaceContainerHighest = Color(0xFF3C3549),
    secondaryContainer = Color(0xFF3D3155), onSecondaryContainer = Color(0xFFE3D9FF),
    outline = Color(0xFF9388A6), outlineVariant = Color(0xFF443C52),
)
private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF6345A0), onPrimary = Color.White,
    secondary = Color(0xFF63557D), tertiary = Color(0xFF8D513C),
    background = Color(0xFFF7F5FA), onBackground = Color(0xFF211B38),
    surface = Color.White, onSurface = Color(0xFF211B38), onSurfaceVariant = Color(0xFF70667E),
    surfaceContainer = Color(0xFFF0EBF6), surfaceContainerHigh = Color(0xFFECE6F4), surfaceContainerHighest = Color(0xFFE4DCED),
    secondaryContainer = Color(0xFFE3D9FF), onSecondaryContainer = Color(0xFF35205D),
    outline = Color(0xFF82758E), outlineVariant = Color(0xFFE2DAEB),
)
@Composable fun TwoAccMessTheme(darkTheme: Boolean = isSystemInDarkTheme(), dynamicColor: Boolean = false, content: @Composable () -> Unit) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= 31 -> if (darkTheme) dynamicDarkColorScheme(LocalContext.current) else dynamicLightColorScheme(LocalContext.current)
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }
    MaterialTheme(colorScheme = colorScheme, typography = Typography, content = content)
}
