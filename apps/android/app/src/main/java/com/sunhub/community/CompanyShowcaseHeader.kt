package com.sunhub.community

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowOutward
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import org.json.JSONObject

/** Identity leads; company work lives beside it, never behind an overlapping avatar. */
@Composable
internal fun CompanyShowcaseHeader(
    model: CommunityModel,
    company: JSONObject,
    project: JSONObject?,
    canEdit: Boolean,
    onEditCover: () -> Unit,
    onWork: () -> Unit,
    identity: @Composable ColumnScope.() -> Unit,
) {
    val cover = company.text("cover_url")
    val image = cover.ifBlank { project?.text("image_url").orEmpty() }
    val showVisual = image.isNotBlank() || canEdit
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).testTag("company-showcase"),
        color = Color.White,
        shape = ConnectCardShape,
    ) {
        BoxWithConstraints(Modifier.padding(20.dp)) {
            if (maxWidth >= 680.dp && showVisual) {
                Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1.15f), verticalArrangement = Arrangement.spacedBy(14.dp), content = identity)
                    ShowcaseVisual(
                        model, company, project, image, cover.isNotBlank(), canEdit, onEditCover, onWork,
                        Modifier.weight(1f),
                    )
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp), content = identity)
                    if (showVisual)
                        ShowcaseVisual(model, company, project, image, cover.isNotBlank(), canEdit, onEditCover, onWork, Modifier.fillMaxWidth())
                }
            }
        }
    }
}

@Composable
private fun ShowcaseVisual(
    model: CommunityModel,
    company: JSONObject,
    project: JSONObject?,
    image: String,
    isCover: Boolean,
    canEdit: Boolean,
    onEditCover: () -> Unit,
    onWork: () -> Unit,
    modifier: Modifier,
) {
    if (image.isBlank()) {
        Surface(modifier = modifier, color = Pale, shape = RoundedCornerShape(18.dp), onClick = onEditCover) {
            Column(
                Modifier.fillMaxWidth().padding(22.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Outlined.Image, null, Modifier.size(28.dp), tint = Muted)
                Text("Show your company at work", style = MaterialTheme.typography.titleSmall)
                Text("Add a cover photo", style = MaterialTheme.typography.bodyMedium, color = Muted)
            }
        }
    } else {
        var imageRatio by remember(image) { mutableFloatStateOf(if (isCover) 0.8f else 1.65f) }
        Column(modifier.clip(RoundedCornerShape(18.dp)).background(Pale)) {
            Box(Modifier.fillMaxWidth().aspectRatio(imageRatio)) {
                AsyncImage(
                    mediaUrl(model, image),
                    if (isCover) "${company.text("name")} at work" else project?.text("name") ?: "Company project",
                    Modifier.fillMaxSize(),
                    contentScale = ContentScale.Fit,
                    onSuccess = { result ->
                        val size = result.painter.intrinsicSize
                        if (isCover && size.width > 0 && size.height > 0) imageRatio = size.width / size.height
                    },
                )
                if (canEdit)
                    FilledTonalIconButton(
                        onClick = onEditCover,
                        modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp),
                        colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = Color.White, contentColor = Ink),
                    ) { Icon(Icons.Outlined.CameraAlt, "Edit cover photo", Modifier.size(20.dp)) }
            }
            if (!isCover && project != null)
                TextButton(onClick = onWork, modifier = Modifier.fillMaxWidth(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)) {
                    Text(project.text("name"), Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
                    Icon(Icons.Outlined.ArrowOutward, "View portfolio", Modifier.size(18.dp))
                }
        }
    }
}
