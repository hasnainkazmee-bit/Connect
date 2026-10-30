package com.sunhub.community

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal fun chatTime(value: String): String = runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("h:mm a")) }.getOrDefault("")
internal fun chatDate(value: String): String = runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("MMM d, yyyy")) }.getOrDefault("")

@Composable
internal fun ChatMessage(model: CommunityModel, message: JSONObject, showReceipt: Boolean, peerRead: Long) {
    val own = message.optString("sender_company_id") == model.company?.optString("id")
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (own) Alignment.End else Alignment.Start) {
        Text(message.optString("author_name"), Modifier.padding(start = 5.dp, end = 5.dp, bottom = 5.dp), style = MaterialTheme.typography.labelSmall, color = Muted)
        Surface(color = if (own) Navy else Color(0xFFF0F5FA), shape = if (own) RoundedCornerShape(18.dp, 4.dp, 18.dp, 18.dp) else RoundedCornerShape(4.dp, 18.dp, 18.dp, 18.dp), modifier = Modifier.widthIn(max = 310.dp)) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                message.optJSONArray("attachments").objects().forEach { attachment ->
                    if (attachment.optString("mime").startsWith("image/")) {
                        var preview by remember(attachment.optString("id"), model.company?.optString("id")) { mutableStateOf<File?>(null) }
                        LaunchedEffect(attachment.optString("id"), model.company?.optString("id")) { preview = runCatching { model.attachmentPreview(attachment) }.getOrNull() }
                        if (preview != null) AsyncImage(preview, attachment.optString("name"), Modifier.width(270.dp).heightIn(min = 130.dp, max = 280.dp).clip(RoundedCornerShape(10.dp)).clickable { model.openAttachment(attachment) }, contentScale = ContentScale.Crop)
                    }
                    Row(Modifier.clip(RoundedCornerShape(9.dp)).background(if (own) Color.White.copy(alpha = .09f) else Color.White).clickable { model.openAttachment(attachment) }.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        Icon(if (attachment.optString("mime").startsWith("image/")) Icons.Outlined.Image else Icons.Outlined.Description, null, Modifier.size(22.dp), tint = if (own) Color.White else Navy)
                        Column(Modifier.weight(1f, fill = false)) { Text(attachment.optString("name"), color = if (own) Color.White else Ink, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis); Text("${(attachment.optLong("size") + 1023) / 1024} KB", color = if (own) Color(0xFFC0D5E5) else Muted, style = MaterialTheme.typography.labelSmall) }
                        Icon(Icons.Outlined.FileDownload, "Download attachment", Modifier.size(16.dp), tint = if (own) Color.White else Navy)
                    }
                }
                if (message.optString("body").isNotBlank()) SelectionContainer { Text(message.optString("body"), color = if (own) Color.White else Ink, style = MaterialTheme.typography.bodyMedium) }
                Text(chatTime(message.optString("created_at")), Modifier.align(Alignment.End), color = if (own) Color(0xFFB7CDDE) else Muted, style = MaterialTheme.typography.labelSmall)
            }
        }
        if (own && showReceipt) Row(Modifier.padding(top = 5.dp, end = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            val read = message.optLong("sequence") <= peerRead
            Icon(if (read) Icons.Outlined.DoneAll else Icons.Outlined.Check, null, Modifier.size(13.dp), tint = if (read) Navy else Muted)
            Text(if (read) "Read" else "Sent", style = MaterialTheme.typography.labelSmall, color = Muted)
        }
    }
}

@Composable
internal fun InboxRow(company: JSONObject, preview: String, time: String, unread: Int, pending: Boolean, click: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(Color.White).clickable(onClick = click).padding(horizontal = 20.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(13.dp)) {
        CompanyAvatar(company, 48)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text(company.optString("name"), Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall, fontWeight = if (unread > 0) FontWeight.Bold else FontWeight.Medium); if (time.isNotBlank()) Text(chatDate(time).substringBefore(","), style = MaterialTheme.typography.labelSmall, color = Muted) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { Text(preview.ifBlank { "${company.optString("type")} · ${company.optString("location")}" }, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = if (unread > 0) Ink else Muted); if (unread > 0) Badge(containerColor = Navy) { Text(if (unread > 99) "99+" else "$unread") } else if (pending) Surface(color = Color(0xFFFFF0DE), shape = RoundedCornerShape(8.dp)) { Text("Request", Modifier.padding(horizontal = 6.dp, vertical = 3.dp), color = Color(0xFFAA651F), style = MaterialTheme.typography.labelSmall) } }
        }
    }
}
