import Script from "next/script";
import "bootstrap/dist/css/bootstrap.min.css";
import "react-toastify/dist/ReactToastify.css";
import "../src/styles/theme.css";
import "../src/styles/StaffShell.css";

export const metadata = {
  title: "Bluebell Staff Portal",
  description: "Staff portal for Bluebell International School",
  icons: { icon: "/favicon.ico?v=3" },
};

// Proper mobile scaling: width follows the device, allow pinch-zoom, and let
// content extend into safe areas (notch / gesture bars).
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        {/* Theme init (runs before paint): applies the saved dark/light choice,
            seeding the OS preference when nothing was chosen yet — prevents a
            theme flash on load. Toggled from the topbar (src/utils/theme.js). */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('jmis-theme');if(t!=='dark'&&t!=='light'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`}
        </Script>
      </body>
    </html>
  );
}
