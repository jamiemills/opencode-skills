import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";

import {
  createEgressBrokerListener,
  createEgressBrokerRelayServer,
} from "../csm-orchestrate/lib/egress-broker.mjs";
import { createHttpForward } from "../csm-orchestrate/lib/verified-sandbox-runtime.mjs";

const deniedListener = () =>
  createEgressBrokerListener({
    broker: {
      decide: () => ({ decision: "denied", reasonCode: "default-deny", limits: null }),
      record: () => ({}),
    },
    forward: async () => ({ status: 200, body: "" }),
  });

test("the relay binds loopback by default", async () => {
  const relay = await createEgressBrokerRelayServer({ listener: deniedListener() });
  try {
    assert.equal(relay.host, "127.0.0.1");
  } finally {
    await relay.close();
  }
});

test("a relay peer that never sends a newline is cut off instead of growing memory", async () => {
  const relay = await createEgressBrokerRelayServer({ listener: deniedListener() });
  try {
    const socket = net.connect(relay.port, relay.host);
    await new Promise((resolve) => socket.once("connect", resolve));
    const outcome = new Promise((resolve) => {
      let seen = "";
      socket.on("data", (chunk) => {
        seen += chunk.toString("utf8");
        if (seen.includes("buffer-overflow")) resolve("overflow");
      });
      socket.on("close", () => resolve("closed"));
      socket.on("error", () => resolve("error"));
    });
    socket.write("x".repeat(2 * 1024 * 1024));
    const result = await outcome;
    assert.ok(["overflow", "closed", "error"].includes(result));
    socket.destroy();
  } finally {
    await relay.close();
  }
});

test("the default HTTP forward rejects a response exceeding maxBytes", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("z".repeat(4096));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const forward = createHttpForward({ maxBytes: 64 });
    await assert.rejects(
      forward({
        target: { scheme: "http", host: "127.0.0.1", port, path: "/" },
        method: "GET",
      }),
      /maxBytes/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
