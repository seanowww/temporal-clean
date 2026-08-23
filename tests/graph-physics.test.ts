import test from "node:test";
import assert from "node:assert/strict";
import { stepGraphPhysics, type PhysicsBody } from "../lib/graph-physics";

test("released graph nodes return toward their authored position", () => {
  const body: PhysicsBody = { id: "node", x: 80, y: 70, homeX: 50, homeY: 50, vx: 0, vy: 0, dragging: false, energy: 1 };
  const initialDistance = Math.hypot(body.x - body.homeX, body.y - body.homeY);
  for (let frame = 0; frame < 240; frame++) stepGraphPhysics([body]);
  assert.ok(Math.hypot(body.x - body.homeX, body.y - body.homeY) < initialDistance);
  assert.ok(Math.abs(body.x - body.homeX) < .2);
  assert.ok(Math.abs(body.y - body.homeY) < .2);
});

test("dragged nodes remain under pointer control", () => {
  const body: PhysicsBody = { id: "node", x: 74, y: 31, homeX: 50, homeY: 50, vx: 1, vy: 1, dragging: true, energy: 1 };
  stepGraphPhysics([body]);
  assert.equal(body.x, 74);
  assert.equal(body.y, 31);
});

test("nearby authored nodes cool, return home, and let the simulation sleep", () => {
  const bodies: PhysicsBody[] = [
    { id: "a", x: 50, y: 50, homeX: 50, homeY: 50, vx: .5, vy: 0, dragging: false, energy: 1 },
    { id: "b", x: 52, y: 50, homeX: 52, homeY: 50, vx: -.5, vy: 0, dragging: false, energy: 1 },
  ];
  let moving = true; let frames = 0;
  while (moving && frames < 600) { moving = stepGraphPhysics(bodies); frames++; }
  assert.equal(moving, false);
  assert.ok(frames < 600);
  assert.deepEqual(bodies.map(({ x, y, homeX, homeY }) => [x, y, homeX, homeY]), [[50, 50, 50, 50], [52, 50, 52, 50]]);
});
