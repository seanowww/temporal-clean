export type PhysicsBody = {
  id: string;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  dragging: boolean;
  energy: number;
};

export function stepGraphPhysics(bodies: PhysicsBody[], delta = 1) {
  const dt = Math.max(.25, Math.min(2.5, delta));
  const spring = .0065 * dt;
  const collisionDistance = 6.4;
  let moving = false;

  for (const body of bodies) {
    if (body.dragging) continue;
    body.vx += (body.homeX - body.x) * spring;
    body.vy += (body.homeY - body.y) * spring;
  }

  for (let left = 0; left < bodies.length; left++) {
    for (let right = left + 1; right < bodies.length; right++) {
      const a = bodies[left]; const b = bodies[right];
      const dx = b.x - a.x; const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || .001;
      if (distance >= collisionDistance) continue;
      const interactionEnergy = Math.max(a.energy, b.energy);
      if (interactionEnergy < .001) continue;
      const force = ((collisionDistance - distance) / collisionDistance) * .022 * interactionEnergy * dt;
      const fx = dx / distance * force; const fy = dy / distance * force;
      if (!a.dragging) { a.vx -= fx; a.vy -= fy; }
      if (!b.dragging) { b.vx += fx; b.vy += fy; }
    }
  }

  const damping = Math.pow(.9, dt);
  for (const body of bodies) {
    if (body.dragging) { moving = true; continue; }
    body.energy *= Math.pow(.94, dt);
    if (body.energy < .001) body.energy = 0;
    body.vx *= damping; body.vy *= damping;
    body.x = Math.max(5, Math.min(95, body.x + body.vx * dt));
    body.y = Math.max(7, Math.min(93, body.y + body.vy * dt));
    const displaced = Math.hypot(body.homeX - body.x, body.homeY - body.y);
    if (Math.hypot(body.vx, body.vy) > .008 || displaced > .035) moving = true;
    else { body.x = body.homeX; body.y = body.homeY; body.vx = 0; body.vy = 0; }
  }
  return moving;
}
