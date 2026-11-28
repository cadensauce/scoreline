package io.github.cadensauce.scoreline

import android.content.Intent
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.annotation.Keep
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging

// Scoreline's Android app. Adds one thing to the standard Tauri activity: the page can ask for this
// phone's push address (Firebase Cloud Messaging token), so the push worker can send alerts while the app is closed.
class MainActivity : TauriActivity() {
  @Volatile private var pushToken: String = ""
  @Volatile private var pushError: String = ""
  // The link of the alert that opened the app ("#g=nfl-401…"); the page takes it once.
  @Volatile private var pendingLink: String = ""

  private fun takeLink(i: Intent?) {
    val l = i?.getStringExtra("link") ?: return
    if (l.startsWith("#")) pendingLink = l
    i.removeExtra("link")
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    takeLink(intent)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    ScorelineMessagingService.ensureChannel(this)
    startFirebase()
    loadToken()
    takeLink(intent)
  }

  // Firebase normally starts itself from res/values/firebase.xml; start it by hand if that didn't happen.
  private fun startFirebase() {
    try {
      if (FirebaseApp.getApps(this).isEmpty()) {
        FirebaseApp.initializeApp(this, FirebaseOptions.Builder()
          .setApplicationId("1:1040992391318:android:159b51321088fcc81eb2b7")
          .setApiKey("AIzaSyAGyc1udyqVakTuZJ0Iqb8Lb9uy4IHdO2w")
          .setProjectId("scoreline-41f14")
          .setGcmSenderId("1040992391318")
          .build())
      }
    } catch (e: Exception) { pushError = "start: " + (e.message ?: e.javaClass.simpleName) }
  }

  private fun loadToken() {
    try {
      FirebaseMessaging.getInstance().token.addOnCompleteListener { t ->
        if (t.isSuccessful) { pushToken = t.result ?: ""; pushError = "" }
        else pushError = "token: " + (t.exception?.message ?: "failed")
      }
    } catch (e: Exception) { pushError = "token: " + (e.message ?: e.javaClass.simpleName) }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(Bridge(), "ScorelineNative")
  }

  @Keep
  inner class Bridge {
    @Keep @JavascriptInterface
    fun pushToken(): String {
      if (pushToken.isEmpty()) loadToken()
      return pushToken
    }

    @Keep @JavascriptInterface
    fun pushError(): String = pushError

    @Keep @JavascriptInterface
    fun pendingLink(): String { val l = pendingLink; pendingLink = ""; return l }
  }
}
