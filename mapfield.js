const CONFIG = {
  DISTANCE: 10000,
  Z_SPAWN_MIN: 5000, // how close (in z) a shape can spawn to its arrival point
  Z_SPAWN_MAX: 9000, // how far a shape can spawn — together these set flight duration variety
  Z_INCREMENT: 10, // flight speed toward the vanishing point
  FRAME_SLEEP: 10,
  ALPHA_FADE_Z: 5000, // remaining z-distance over which alpha fades in
  COLOR_TRANSITION_Z: 1000, // remaining z-distance over which color/lineWidth fade
  DOCKED_SCALE: 1, // don't want to edit actually -  final zoom every docked shape settles to - don'
  DOCK_PROBABILITY: 1,
  COLORS: {
    INFLIGHT: { r: 94, g: 255, b: 137 },
    DOCKED: { r: 94, g: 255, b: 137 },
    // DOCKED: { r: 255, g: 0, b: 191 }, // fuscia
  },
  LINE_WIDTH: {
    INFLIGHT: .5,
    DOCKED: .9,
  },
  BORDER_MARGIN: 50, // make negative to inset map
  ZOOM: 1, // optional zoom setting applied to the entire map
};

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
function clamp01(t) {
  return Math.max(0, Math.min(1, t));
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
    this.bounds = bounds;

    // Exact z at which perspective(z) === DOCKED_SCALE.
    this.zFinal = CONFIG.DISTANCE * (1 / CONFIG.DOCKED_SCALE - 1);

    this.respawn();
  }

  respawn() {
    this.willDock = Math.random() < CONFIG.DOCK_PROBABILITY;
    this.phase = "inflight";

    this.originX = this.dockX / CONFIG.DOCKED_SCALE;
    this.originY = this.dockY / CONFIG.DOCKED_SCALE;

    // Random starting depth - trajectory converges on the same zFinal regardless of start.
    this.z =
      this.zFinal +
      CONFIG.Z_SPAWN_MIN +
      Math.random() * (CONFIG.Z_SPAWN_MAX - CONFIG.Z_SPAWN_MIN);

    this.x = this.originX;
    this.y = this.originY;
    this.scale = 1;
    this.alpha = 0;
    this.currentColor = CONFIG.COLORS.INFLIGHT;
    this.currentLineWidth = CONFIG.LINE_WIDTH.INFLIGHT;
  }

  randomSign() {
    return Math.random() < 0.5 ? -1 : 1;
  }

  update() {
    if (this.phase === "docked") {
      return;
    }

    this.z -= CONFIG.Z_INCREMENT;

    if (this.willDock && this.z <= this.zFinal) {
      this.z = this.zFinal;
      this.x = this.dockX;
      this.y = this.dockY;
      this.scale = CONFIG.DOCKED_SCALE;
      this.alpha = 1;
      this.currentColor = CONFIG.COLORS.DOCKED;
      this.currentLineWidth = CONFIG.LINE_WIDTH.DOCKED;
      this.phase = "docked";
      return;
    }

    const perspective = CONFIG.DISTANCE / (this.z + CONFIG.DISTANCE);
    this.x = this.originX * perspective;
    this.y = this.originY * perspective;
    this.scale = perspective;

    // Alpha fades in as remaining distance to arrival shrinks.
    // remaining = 0 at arrival -> alpha = 1
    // remaining >= ALPHA_FADE_Z -> alpha = 0
    const remaining = this.z - this.zFinal;
    this.alpha = 1 - clamp01(remaining / CONFIG.ALPHA_FADE_Z);

    if (this.willDock) {
      const colorT = 1 - clamp01(remaining / CONFIG.COLOR_TRANSITION_Z);
      this.currentColor = lerpColor(
        CONFIG.COLORS.INFLIGHT,
        CONFIG.COLORS.DOCKED,
        colorT,
      );
      this.currentLineWidth = lerp(
        CONFIG.LINE_WIDTH.INFLIGHT,
        CONFIG.LINE_WIDTH.DOCKED,
        colorT,
      );
    } else {
      // Passthrough shapes have no zFinal target — fall back to a fixed
      // reference distance so they still fade in sensibly. Reusing
      // ALPHA_FADE_Z against raw z (relative to CONFIG.DISTANCE's zero point)
      // approximates the old behavior.
      this.alpha = clamp01(1 - this.z / CONFIG.ALPHA_FADE_Z);
    }
  }

  isOffscreen(width, height, margin = CONFIG.BORDER_MARGIN) {
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

    const projectFn = (lonLat) => projection(lonLat);

    const preprocessor = new GeometryPreprocessor(projectFn);

    const shapeDataList = preprocessor.flattenFeatureCollection(geojson);

    this.shapes = shapeDataList.map((shapeData, i) => {
      const worldShapeData = {
        ...shapeData,
        dockX: (shapeData.dockX - this.width / 2) * CONFIG.ZOOM,
        dockY: (this.height / 2 - shapeData.dockY) * CONFIG.ZOOM,
        relativeRings: shapeData.relativeRings.map((ring) =>
          ring.map(([x, y]) => [x * CONFIG.ZOOM, y * CONFIG.ZOOM]),
        ),
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
      if (shape.phase === "docked") {
        // console.log("SHAPE", shape);
        // debugger;
        continue;
      }
      shape.update();
      if (
        shape.phase !== "docked" &&
        shape.isOffscreen(this.width, this.height)
      ) {
        shape.respawn();
      }
    }
  }

  renderShapes() {
    for (const shape of this.shapes) {
      const alpha = shape.phase === "docked" ? 1 : shape.alpha;
      this.context.strokeStyle = `rgba(${shape.currentColor.r}, ${shape.currentColor.g}, ${shape.currentColor.b}, ${alpha})`;
      this.context.lineWidth = shape.currentLineWidth;

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

// just bedsty
// const file = "./data/smallsty.json";

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
    geometries: geojson.geometries,
  };

  const app = new MapAssemblyAnimation("canvas", smallGeojson);
  app.start();
});
