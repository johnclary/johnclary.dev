// Configuration
const CONFIG = {
  DISTANCE: -10000,
  INIT_MAX_Z: 400,
  ALPHA_SCALE_DOMAIN: 2500,
  Z_INCREMENT: 3,
  FRAME_SLEEP: 10,
  DOCK_START_MIN: 0.05,
  DOCK_START_MAX: 0.5,
  DOCK_TRIGGER_DISTANCE: 5, // screen px to target that triggers docking
  DOCK_DURATION_FRAMES: 10, // fixed duration, per-piece chaos
  DOCK_PROBABILITY: 0.75, // chance a shape is willDock at spawn
  COLORS: {
    // INFLIGHT: {r: 255, g: 0, b: 191},
    INFLIGHT: { r: 94, g: 255, b: 137 },
    DOCKED: { r: 94, g: 255, b: 137 },
  },
  LINE_WIDTH: {
    INFLIGHT: 0.5,
    DOCKED: 2,
  },
};

// ---- Easing ----
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  return {
    r: lerp(c1.r, c2.r, t),
    g: lerp(c1.g, c2.g, t),
    b: lerp(c1.b, c2.b, t),
  };
}

// ---- Geometry preprocessing ----
// Flattens Polygon/MultiPolygon features into a flat list of
// independent shapes: { centroidLonLat, rings: [[ [x,y], ... ], ...] }
// rings[0] = exterior, rings[1:] = holes, all as centroid-relative offsets
// once projected.
class GeometryPreprocessor {
  constructor(projectFn) {
    // projectFn: ([lon, lat]) => [screenX, screenY]
    this.project = projectFn;
  }

  flattenFeatureCollection(geojson) {
    const isGeomCollection = geojson.type === "GeometryCollection";

    const shapes = [];

    if (isGeomCollection) {
      for (const geometry of geojson.geometries) {
        shapes.push(...this.flattenGeometry(geometry));
      }
    } else {
      for (const feature of geojson.features) {
        shapes.push(...this.flattenGeometry(feature.geometry));
      }
    }

    return shapes;
  }

  flattenGeometry(geometry) {
    if (geometry.type === "Polygon") {
      return [this.buildShape(geometry.coordinates)];
    }
    if (geometry.type === "MultiPolygon") {
      return geometry.coordinates.map((polygonCoords) =>
        this.buildShape(polygonCoords),
      );
    }
    return [];
  }

  buildShape(ringsLonLat) {
    // Project every ring to screen space first
    const projectedRings = ringsLonLat.map((ring) =>
      ring.map((coord) => this.project(coord)),
    );

    // Centroid from the exterior ring (simple average; swap for a proper
    // polygon centroid formula later if visual balance matters)
    const exterior = projectedRings[0];
    const centroid = exterior.reduce(
      (acc, [x, y]) => [
        acc[0] + x / exterior.length,
        acc[1] + y / exterior.length,
      ],
      [0, 0],
    );

    // Store all rings as centroid-relative offsets
    const relativeRings = projectedRings.map((ring) =>
      ring.map(([x, y]) => [x - centroid[0], y - centroid[1]]),
    );

    return {
      dockX: centroid[0],
      dockY: centroid[1],
      relativeRings,
    };
  }
}

// ---- Animated shape unit ----
class AnimatedShape {
  constructor(shapeData, id, bounds) {
    this.id = id;
    this.dockX = shapeData.dockX;
    this.dockY = shapeData.dockY;
    this.relativeRings = shapeData.relativeRings;
    this.bounds = bounds; // { width, height } for spawn/offscreen logic

    this.respawn();
  }

  respawn() {
    this.willDock = Math.random() < CONFIG.DOCK_PROBABILITY;
    this.phase = "inflight";

    if (this.willDock) {
      // Stay on the ray toward this shape's real dock position (correct
      // direction), but randomize how far out it starts along that ray
      // for spawn/timing variety.
      const k =
        CONFIG.DOCK_START_MIN +
        Math.random() * (CONFIG.DOCK_START_MAX - CONFIG.DOCK_START_MIN);
      this.originX = this.dockX * k;
      this.originY = this.dockY * k;
    } else {
      // Passthrough shapes: fully random direction, unrelated to any
      // dock target — this is the "floating past" look.
      this.originX =
        Math.floor(Math.random() * (this.bounds.width / 2)) * this.randomSign();
      this.originY =
        Math.floor(Math.random() * (this.bounds.height / 2)) *
        this.randomSign();
    }

    this.x = this.originX;
    this.y = this.originY;
    this.prevX = this.originX;
    this.prevY = this.originY;

    this.z = Math.random() * CONFIG.INIT_MAX_Z;
    this.scale = 1;
    this.alpha = 0;

    this.dockFrame = 0;
    this.frozen = null;
    this.prevDistToDock = Infinity;
  }

  //   central origin
  //   respawn() {
  //     const START_FRACTION = 0.02; // spawn near center, along the ray toward this shape's dock position
  //     this.originX = this.dockX * START_FRACTION;
  //     this.originY = this.dockY * START_FRACTION;
  //     this.x = this.originX;
  //     this.y = this.originY;
  //     this.z = Math.random() * CONFIG.INIT_MAX_Z;
  //     this.scale = 1;
  //     this.alpha = 0;

  //     this.willDock = Math.random() < CONFIG.DOCK_PROBABILITY;
  //     this.phase = "inflight";

  //     this.dockFrame = 0;
  //     this.frozen = null;
  //   }

  //   respawn() {
  //     this.originX =
  //       Math.floor(Math.random() * (this.bounds.width / 2)) * this.randomSign();
  //     this.originY =
  //       Math.floor(Math.random() * (this.bounds.height / 2)) * this.randomSign();
  //     this.x = this.originX;
  //     this.y = this.originY;
  //     this.z = Math.random() * CONFIG.INIT_MAX_Z;
  //     this.scale = 1;
  //     this.alpha = 0;

  //     this.willDock = Math.random() < CONFIG.DOCK_PROBABILITY;
  //     this.phase = "inflight";

  //     // Populated at trigger time
  //     this.dockFrame = 0;
  //     this.frozen = null;
  //   }

  randomSign() {
    return Math.random() < 0.5 ? -1 : 1;
  }

  projectInflight() {
    const perspective = CONFIG.DISTANCE / (this.z + CONFIG.DISTANCE);
    this.x = this.originX * perspective;
    this.y = this.originY * perspective;
    this.scale = perspective;
    this.alpha = Math.min(1, this.z / CONFIG.ALPHA_SCALE_DOMAIN);
  }

  triggerDocking(freezeX = this.x, freezeY = this.y) {
    this.phase = "docking";
    this.dockFrame = 0;
    this.frozen = {
      x: freezeX,
      y: freezeY,
      scale: this.scale,
      color: { ...CONFIG.COLORS.INFLIGHT },
      lineWidth: CONFIG.LINE_WIDTH.INFLIGHT,
    };
  }

  updateDocking() {
    this.dockFrame += 1;
    const t = Math.min(1, this.dockFrame / CONFIG.DOCK_DURATION_FRAMES);
    const eased = easeOutCubic(t);

    this.x = lerp(this.frozen.x, this.dockX, eased);
    this.y = lerp(this.frozen.y, this.dockY, eased);
    this.scale = lerp(this.frozen.scale, 1, eased);
    this.currentColor = lerpColor(
      this.frozen.color,
      CONFIG.COLORS.DOCKED,
      eased,
    );
    this.currentLineWidth = lerp(
      this.frozen.lineWidth,
      CONFIG.LINE_WIDTH.DOCKED,
      eased,
    );

    if (t >= 1) {
      this.phase = "docked";
    }
  }

  isOffscreen(width, height, margin = 50) {
    return (
      Math.abs(this.x) > width / 2 + margin ||
      Math.abs(this.y) > height / 2 + margin
    );
  }
}

// ---- Main animator ----
class MapAssemblyAnimation {
  constructor(canvasSelector, geojson) {
    this.initializeCanvas(canvasSelector);
    const projection = d3
      .geoIdentity()
      .reflectY(true)
      .fitSize([this.width, this.height], geojson);
    // const projection = d3
    //   .geoMercator()
    //   .fitSize([this.width, this.height], geojson);

    console.log({
      "scale:": projection.scale(),
      "translate:": projection.translate(),
    });
    const projectFn = (lonLat) => projection(lonLat);

    const preprocessor = new GeometryPreprocessor(projectFn);

    const shapeDataList = preprocessor.flattenFeatureCollection(geojson);

    // this.shapes = shapeDataList.map(
    //   (shapeData, i) =>
    //     new AnimatedShape(shapeData, i, {
    //       width: this.width,
    //       height: this.height,
    //     }),
    // );

    this.shapes = shapeDataList.map((shapeData, i) => {
      const worldShapeData = {
        ...shapeData,
        dockX: shapeData.dockX - this.width / 2,
        dockY: this.height / 2 - shapeData.dockY,
      };
      return new AnimatedShape(worldShapeData, i, {
        width: this.width,
        height: this.height,
      });
    });

    this.then = performance.now();
  }

  initializeCanvas(selector) {
    const { width, height } = document.body.getBoundingClientRect();
    this.width = width;
    this.height = height;

    this.canvas = d3
      .select(selector)
      .attr("height", height)
      .attr("width", width);
    this.context = this.canvas.node().getContext("2d");
  }

  applyCanvasOffset(x, y) {
    return {
      x: x + this.width / 2,
      y: this.height / 2 - y,
    };
  }

  updateShapes() {
    for (const shape of this.shapes) {
      if (shape.phase === "inflight") {
        const prevX = shape.x;
        const prevY = shape.y;

        shape.z += CONFIG.Z_INCREMENT;
        shape.projectInflight();

        if (shape.isOffscreen(this.width, this.height)) {
          shape.respawn();
          continue;
        }

        if (shape.willDock) {
          const dist = Math.sqrt(
            (shape.x - shape.dockX) ** 2 + (shape.y - shape.dockY) ** 2,
          );
          const passedClosestApproach = dist > shape.prevDistToDock;

          if (passedClosestApproach) {
            // Freeze at last frame's position — still approaching, not overshot —
            // so the ease-in only ever moves the shape forward toward dock.
            shape.triggerDocking(prevX, prevY);
          } else if (dist <= CONFIG.DOCK_TRIGGER_DISTANCE) {
            shape.triggerDocking(shape.x, shape.y);
          }
          shape.prevDistToDock = dist;
        }
      } else if (shape.phase === "docking") {
        shape.updateDocking();
      }
    }
  }

  renderShapes() {
    for (const shape of this.shapes) {
      const isDocked = shape.phase === "docked";
      const color = isDocked
        ? CONFIG.COLORS.DOCKED
        : shape.currentColor || CONFIG.COLORS.INFLIGHT;
      const lineWidth = isDocked
        ? CONFIG.LINE_WIDTH.DOCKED
        : shape.currentLineWidth || CONFIG.LINE_WIDTH.INFLIGHT;
      const alpha = shape.phase === "inflight" ? shape.alpha : 1;

      this.context.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
      this.context.lineWidth = lineWidth;

      const originScreen = this.applyCanvasOffset(shape.x, shape.y);

      this.context.beginPath();

      for (const ring of shape.relativeRings) {
        ring.forEach(([dx, dy], i) => {
          const px = originScreen.x + dx * shape.scale;
          const py = originScreen.y + dy * shape.scale;
          if (i === 0) this.context.moveTo(px, py);
          else this.context.lineTo(px, py);
        });
        this.context.closePath();
      }
      this.context.stroke();
    }
  }

  animate() {
    const now = performance.now();
    const elapsed = now - this.then;

    if (elapsed < CONFIG.FRAME_SLEEP) {
      requestAnimationFrame(() => this.animate());
      return;
    }

    this.context.clearRect(0, 0, this.width, this.height);
    this.updateShapes();
    this.renderShapes();

    this.then = now - (elapsed % CONFIG.FRAME_SLEEP);
    requestAnimationFrame(() => this.animate());
  }

  start() {
    this.animate();
  }
}
const file = "./data/nyc_precision_filtered_clipped_polygons_wgs84.json";

async function loadData(file) {
  try {
    const response = await fetch(file);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Could not load JSON file:", error);
  }
}

loadData(file).then((geojson) => {
  const smallGeojson = {
    ...geojson,
    geometries: geojson.geometries.slice(500, 2000),
  };

  const app = new MapAssemblyAnimation("canvas", smallGeojson);
  app.start();
});
