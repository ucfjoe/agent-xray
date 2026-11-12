window.__ModuleLoader__.load({
  id: "dsh-agent-xray",
  factory: (require) => {
    const React = require("react");

    function Panel({ sessionId }) {
      const frame = React.useRef(null);
      const syncTheme = React.useCallback(() => {
        const target = frame.current?.contentDocument?.documentElement;
        if (!target) return;
        const theme = getComputedStyle(document.body);
        for (const name of theme) {
          if (name.startsWith("--dsw-") || name.startsWith("--ds-")) {
            target.style.setProperty(name, theme.getPropertyValue(name));
          }
        }
        target.style.colorScheme = theme.colorScheme;
        target.style.fontFamily = theme.fontFamily;
      }, []);

      React.useEffect(() => {
        const observer = new MutationObserver(syncTheme);
        const options = {
          attributes: true,
          attributeFilter: ["class", "style", "data-ds-dark-theme"],
        };
        observer.observe(document.documentElement, options);
        observer.observe(document.body, options);
        const preference = matchMedia("(prefers-color-scheme: dark)");
        preference.addEventListener("change", syncTheme);
        syncTheme();
        return () => {
          observer.disconnect();
          preference.removeEventListener("change", syncTheme);
        };
      }, [syncTheme]);

      return React.createElement("iframe", {
        ref: frame,
        title: "Agent X-Ray",
        src:
          "/agent-xray/index.html?live=1&session=" +
          encodeURIComponent(sessionId),
        onLoad: syncTheme,
        style: {
          display: "block",
          width: "100%",
          height: "100%",
          minHeight: 0,
          border: 0,
        },
      });
    }

    function apply(ctx) {
      ctx.inject(["slots", "sidebarRightTabs"], (inner) => {
        const slots = inner.get("slots");
        inner.effect(
          () =>
            inner.get("sidebarRightTabs").register({
              id: "dsh-agent-xray",
              kind: "agent-xray",
              priority: "extension",
              keepMounted: true,
              title: () => "Agent X-Ray",
              guide: [
                {
                  id: "agent-xray",
                  order: 15,
                  title: () => "Agent X-Ray",
                  description: () => "Inspect code changes and their context",
                },
              ],
            }),
          "agent-xray: sidebar type",
        );
        inner.effect(
          () =>
            slots.inject("sidebar.right.pane.tab", () =>
              slots.register(
                {
                  name: "sidebar.right.pane.tab",
                  key: "dsh-agent-xray",
                },
                Panel,
              ),
            ),
          "agent-xray: sidebar body",
        );
      });
    }
    return { apply };
  },
});
