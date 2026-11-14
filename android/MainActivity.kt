package io.github.cadensauce.scoreline

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import com.google.firebase.messaging.FirebaseMessaging

// Scoreline's Android app. Adds one thing to the standard Tauri activity: the page can ask for this
// phone's push address (Firebase Cloud Messaging token), so the push worker can send alerts while the app is closed.
class MainActivity : TauriActivity() {
  @Volatile private var pushToken: String = ""

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    ScorelineMessagingService.ensureChannel(this)
    loadToken()
  }

  private fun loadToken() {
    try {
      FirebaseMessaging.getInstance().token.addOnCompleteListener { t ->
        if (t.isSuccessful) pushToken = t.result ?: ""
      }
    } catch (_: Exception) {}
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(Bridge(), "ScorelineNative")
  }

  inner class Bridge {
    @JavascriptInterface
    fun pushToken(): String {
      if (pushToken.isEmpty()) loadToken()
      return pushToken
    }
  }
}
