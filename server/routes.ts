import type { Express } from "express";
import { createServer, type Server } from "node:http";
import { registerPaystackRoutes } from "./paystack";
import { registerKycRoutes } from "./kyc";
import { registerAdBillingRoutes } from "./adBilling";

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Payments (Paystack) + KYC (Smile Identity). Secrets stay server-side; both are
  // mock-by-default and go live automatically when their env keys are set.
  registerPaystackRoutes(app);
  registerKycRoutes(app);
  // Billboards in EMILGO Games: the advertiser portal's checkouts (Paystack,
  // Flutterwave, Stripe), mock until their keys are set.
  registerAdBillingRoutes(app);

  app.post("/api/webhooks/scan-success", async (req, res) => {
    try {
      const { driverPushToken, passengerPushToken, driverName, passengerName, tripId } = req.body;

      const messages = [];

      // Message for Driver
      if (driverPushToken) {
        messages.push({
          to: driverPushToken,
          sound: "default",
          title: "🚀 Trip Started!",
          body: `Passenger ${passengerName || "Scan"} confirmed your QR code. Have a safe trip!`,
          data: { tripId, role: "driver", type: "scan_success" },
        });
      }

      // Message for Passenger
      if (passengerPushToken) {
        messages.push({
          to: passengerPushToken,
          sound: "default",
          title: "✅ Driver Confirmed!",
          body: `You are now linked with ${driverName || "your driver"}. Enjoy your ride!`,
          data: { tripId, role: "passenger", type: "scan_success" },
        });
      }

      if (messages.length > 0) {
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Accept-encoding": "gzip, deflate",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(messages),
        });
        
        const receipt = await response.json();
        console.log("[Webhook] Push notifications sent:", receipt);
      }

      res.status(200).json({ success: true, message: "Notifications dispatched" });
    } catch (error) {
      console.error("[Webhook] Error sending push notifications:", error);
      res.status(500).json({ success: false, error: "Failed to dispatch notifications" });
    }
  });

  return createServer(app);
}
