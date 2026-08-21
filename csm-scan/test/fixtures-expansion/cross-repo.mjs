// T226 topic fixture — cross-repository relationships.
//
// Two-repository fixture with an EXACT shared contract reference. Both repos
// declare the same protobuf `OrderService` contract (an exact reference), so
// the global synthesis must:
//   - retain both repository identities (metrics.repositories === 2),
//   - keep the shared exact reference as an AMBIGUOUS record (two identical
//     candidates) rather than fabricating an edge,
//   - exclude ambiguity from the cross-repository edge metric.
//
// The `distinct` variant declares disjoint services so each repo's exact
// reference resolves to exactly one candidate and forms a self-edge (the
// reference machinery resolves; single-candidate resolution is proven).

export const repoA = {
  "package.json": JSON.stringify({ name: "worker", type: "module" }),
  "proto/order.proto": [
    'syntax = "proto3";',
    "package acme.orders.v1;",
    "service OrderService {",
    "  rpc GetOrder(OrderRequest) returns (OrderReply);",
    "}",
    "message OrderRequest { string id = 1; }",
    "message OrderReply { string id = 1; }",
    "",
  ].join("\n"),
};

export const repoB = {
  "package.json": JSON.stringify({ name: "worker", type: "module" }),
  "proto/order.proto": [
    'syntax = "proto3";',
    "package acme.orders.v1;",
    "service OrderService {",
    "  rpc ListOrders(ListRequest) returns (ListReply);",
    "}",
    "message ListRequest { string id = 1; }",
    "message ListReply { string id = 1; }",
    "",
  ].join("\n"),
};

export const repoASingle = {
  "package.json": JSON.stringify({ name: "worker", type: "module" }),
  "proto/order.proto": [
    'syntax = "proto3";',
    "service ServiceA {",
    "  rpc GetA(Request) returns (Reply);",
    "}",
    "message Request { string id = 1; }",
    "message Reply { string id = 1; }",
    "",
  ].join("\n"),
};

export const repoBSingle = {
  "package.json": JSON.stringify({ name: "worker", type: "module" }),
  "proto/order.proto": [
    'syntax = "proto3";',
    "service ServiceB {",
    "  rpc GetB(Request) returns (Reply);",
    "}",
    "message Request { string id = 1; }",
    "message Reply { string id = 1; }",
    "",
  ].join("\n"),
};
