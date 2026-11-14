package io.github.cadensauce.scoreline

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

// Receives alerts from the Scoreline push worker and shows them, even when the app is closed.
class ScorelineMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(msg: RemoteMessage) {
    val d = msg.data
    val title = d["title"] ?: msg.notification?.title ?: return
    val body = d["body"] ?: msg.notification?.body ?: ""
    show(this, title, body, d["tag"] ?: title)
  }

  // The page reads the new address next time the app opens and saves it.
  override fun onNewToken(token: String) {}

  companion object {
    const val CHANNEL = "scores"

    fun ensureChannel(ctx: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
      if (nm.getNotificationChannel(CHANNEL) != null) return
      val ch = NotificationChannel(CHANNEL, "Score alerts", NotificationManager.IMPORTANCE_HIGH)
      ch.description = "Scores, finals and big news for teams you follow"
      nm.createNotificationChannel(ch)
    }

    fun show(ctx: Context, title: String, body: String, tag: String) {
      ensureChannel(ctx)
      val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        ?.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP }
      val pi = open?.let {
        PendingIntent.getActivity(ctx, tag.hashCode(), it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }
      val n = NotificationCompat.Builder(ctx, CHANNEL)
        .setSmallIcon(R.drawable.ic_stat_scoreline)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .apply { if (pi != null) setContentIntent(pi) }
        .build()
      try { NotificationManagerCompat.from(ctx).notify(tag, 1, n) } catch (_: SecurityException) {}
    }
  }
}
