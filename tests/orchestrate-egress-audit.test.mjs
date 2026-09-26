import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import {
  createEgressBrokerListener,
  createEgressBrokerRelayServer,
} from "../csm-orchestrate/lib/egress-broker.mjs";

const allowedBroker = (records) => ({
  decide: () => ({
    decision: "allowed",
    reasonCode: "allowlist-match",
    limits: {},
    injection: null,
    credentialRef: null,
  }),
  record: (decided) => {
    const row = { decision: decided.decision, reasonCode: decided.reasonCode };
    records.push(row);
    return row;
  },
});

const target = { host: "api.example.com", port: 443, scheme: "https", path: "/x" };

test("an allowed forward failure is audited and returns instead of throwing", async () => {
  const records = [];
  const listener = createEgressBrokerListener({
    broker: allowedBroker(records),
    forward: async () => {
      throw new Error("upstream exploded");
    },
  });
  const result = await listener.handle({ target });
  assert.equal(result.decision, "denied");
  assert.equal(result.reasonCode, "forward-error");
  assert.equal(result.upstream, null);
  assert.equal(records.length, 1);
  assert.equal(records[0].reasonCode, "forward-error");
});

test("a successful allowed forward writes exactly one audit row", async () => {
  const records = [];
  const listener = createEgressBrokerListener({
    broker: allowedBroker(records),
    forward: async () => ({ status: 200, headers: {}, body: "ok" }),
  });
  const result = await listener.handle({ target });
  assert.equal(result.decision, "allowed");
  assert.equal(records.length, 1);
});

const readLine = (socket) =>
  new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline !== -1) {
        socket.off("data", onData);
        resolve(JSON.parse(buffer.slice(0, newline)));
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });

test("a malformed relay frame gets an error response instead of a silent hang", async () => {
  const broker = {
    decide: () => ({ decision: "denied", reasonCode: "default-deny", limits: null }),
    record: () => ({}),
  };
  const listener = createEgressBrokerListener({
    broker,
    forward: async () => ({ status: 200, body: "" }),
  });
  const relay = await createEgressBrokerRelayServer({ listener });
  try {
    const socket = net.connect(relay.port, relay.host);
    const response = readLine(socket);
    socket.write("{not-json}\n");
    assert.equal((await response).reasonCode, "malformed-request");
    socket.destroy();
  } finally {
    await relay.close();
  }
});

test("a relay forward error gets a forward-error response", async () => {
  const records = [];
  const listener = createEgressBrokerListener({
    broker: allowedBroker(records),
    forward: async () => {
      throw new Error("boom");
    },
  });
  const relay = await createEgressBrokerRelayServer({ listener });
  try {
    const socket = net.connect(relay.port, relay.host);
    const response = readLine(socket);
    socket.write(`${JSON.stringify({ id: "r1", target })}\n`);
    const line = await response;
    assert.equal(line.reasonCode, "forward-error");
    assert.equal(line.id, "r1");
    socket.destroy();
    assert.equal(records.length, 1);
  } finally {
    await relay.close();
  }
});
