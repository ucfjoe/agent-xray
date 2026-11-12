import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("registers X-Ray as a retained native right-sidebar panel", async () => {
  let plugin;
  const registrations = [];
  const definitions = [];
  const slots = {
    inject: (_name, callback) => callback("session-a"),
    register: (entry, component) => {
      registrations.push({ entry, component });
      return () => {};
    },
  };
  const ctx = {
    inject: (_services, callback) => callback(ctx),
    get: (name) =>
      ({
        slots,
        sidebarRightTabs: {
          register: (definition) => definitions.push(definition),
        },
      })[name],
    effect: (callback) => callback("session-a"),
  };
  vm.runInNewContext(
    await readFile(new URL("../plugin/client.js", import.meta.url), "utf8"),
    {
      window: {
        __ModuleLoader__: {
          load: ({ factory }) => {
            plugin = factory(() => ({
              useRef: () => ({ current: null }),
              useCallback: (fn) => fn,
              useEffect: () => {},
              createElement: (type, props) => ({ type, props }),
            }));
          },
        },
      },
    },
  );
  plugin.apply(ctx);
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].kind, "agent-xray");
  assert.equal(definitions[0].keepMounted, true);
  assert.equal(definitions[0].guide[0].title(), "Agent X-Ray");
  assert.deepEqual(
    registrations.map(({ entry }) => entry.name),
    ["sidebar.right.pane.tab"],
  );
  assert.equal(registrations[0].entry.key, definitions[0].id);
  const wrapper = registrations[0].component();
  const panel = wrapper.type(wrapper.props);
  assert.equal(
    panel.props.src,
    "/agent-xray/index.html?live=1&session=session-a",
    "normal sessions must open live data, not fictional examples",
  );
});
