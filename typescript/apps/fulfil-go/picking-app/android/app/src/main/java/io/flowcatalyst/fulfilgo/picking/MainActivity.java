package io.flowcatalyst.fulfilgo.picking;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Local plugins register BEFORE super.onCreate (Capacitor requirement).
    registerPlugin(TcpPrintPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
