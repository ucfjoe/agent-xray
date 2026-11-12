window.__ModuleLoader__.load({
  id: "dsh-agent-xray",
  factory: (require) => {
    const React = require("react");
    function Panel() {
      return React.createElement("iframe", {
        title: "Agent X-Ray",
        src: "/agent-xray/index.html?live=1",
        style: { width: "100%", height: "100%", minHeight: "600px", border: 0 },
      });
    }
    function apply(ctx) {
      ctx.inject(["slots"], (inner) => {
        const slots = inner.get("slots");
        inner.effect(() => slots.inject("conversation.view", () => slots.register({
          name: "conversation.view",
          id: "agent-xray",
          order: 35,
          label: () => "Agent X-Ray",
        }, Panel)), "agent-xray: session tab");
      });
    }
    return { apply };
  },
});
