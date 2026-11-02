package com.sunhub.community

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp

/** Shared primary action: solar orange, with readable dark text and a 48 dp target. */
@Composable
internal fun ConnectButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = RoundedCornerShape(12.dp),
    colors: ButtonColors = ButtonDefaults.buttonColors(containerColor = Orange, contentColor = Ink),
    elevation: ButtonElevation? = ButtonDefaults.buttonElevation(),
    border: BorderStroke? = null,
    contentPadding: PaddingValues = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
    content: @Composable RowScope.() -> Unit,
) {
    Button(
        onClick,
        modifier.heightIn(min = 48.dp),
        enabled,
        shape,
        colors,
        elevation,
        border,
        contentPadding = contentPadding,
        content = content,
    )
}

internal const val FeedWidthDp = 720
internal const val WorkspaceWidthDp = 840

@Composable
internal fun ConnectOutlinedButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = RoundedCornerShape(12.dp),
    colors: ButtonColors = ButtonDefaults.outlinedButtonColors(contentColor = Ink),
    border: BorderStroke? = ButtonDefaults.outlinedButtonBorder(enabled),
    contentPadding: PaddingValues = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
    content: @Composable RowScope.() -> Unit,
) {
    OutlinedButton(
        onClick,
        modifier.heightIn(min = 48.dp),
        enabled,
        shape,
        colors,
        border = border,
        contentPadding = contentPadding,
        content = content,
    )
}

/** Legacy formats stay readable without advertising additional publishing choices. */
internal fun publicationLabel(kind: String) =
    when (kind) {
        "press_release" -> "Press release"
        "article",
        "case_study" -> "Company update"
        else -> "Post"
    }
