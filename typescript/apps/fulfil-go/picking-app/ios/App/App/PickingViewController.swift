import UIKit
import Capacitor

/**
 * Bridge subclass whose only job is registering the app's local plugins —
 * Capacitor stopped auto-discovering in-app plugins in v5. Main.storyboard
 * points its root view controller here.
 */
class PickingViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TcpPrintPlugin())
    }
}
