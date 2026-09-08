const COLORS = {
  bikePaint: { r: 2, g: 141, b: 66 }, // "#028d42",
  lightGreen: { r: 94, g: 255, b: 137 }, // #5eff89
  fuscia: { r: 255, g: 0, b: 191 }, // fuscia
  white: { r: 255, g: 255, b: 255 },
};

const CONFIG = {
  COLOR: COLORS.white,
  LINE_WIDTH: 1,
  ZOOM: 1.8, // optional zoom setting applied to the entire map
  X_OFFSET: 395, // adjust the viewport size passed to the map projection
  Y_OFFSET: -20, // adjust the viewport size passed to the map projection
};

// ---- Geometry preprocessing ----
// Flattens Polygon/MultiPolygon/LineString/MultiLineString features into a
// flat list of independent shapes: { points: [[x,y], ...], isClosed }
// Lines carry isClosed: false so they render as open paths.
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
        if (!feature.geometry) {
          continue;
        }
        shapes.push(...this.flattenGeometry(feature.geometry));
      }
    }

    return shapes;
  }

  flattenGeometry(geometry) {
    if (!geometry?.type) {
      console.log("geom", geometry);
      debugger;
    }

    if (geometry.type === "Polygon") {
      return [this.buildShape(geometry.coordinates, true)];
    }
    if (geometry.type === "MultiPolygon") {
      return geometry.coordinates.map((polygonCoords) =>
        this.buildShape(polygonCoords, true),
      );
    }
    if (geometry.type === "LineString") {
      return [this.buildShape([geometry.coordinates], false)];
    }
    if (geometry.type === "MultiLineString") {
      return geometry.coordinates.map((lineCoords) =>
        this.buildShape([lineCoords], false),
      );
    }
    return [];
  }

  buildShape(ringsLonLat, isClosed) {
    const rings = ringsLonLat.map((ring) => ring.map((coord) => this.project(coord)));
    return { rings, isClosed };
  }
}

// ---- Static map renderer ----
class MapRenderer {
  constructor(canvasSelector, geojson) {
    this.initializeCanvas(canvasSelector);

    const projection = d3
      .geoIdentity()
      .reflectY(true)
      .fitSize(
        [this.width + CONFIG.X_OFFSET, this.height + CONFIG.Y_OFFSET],
        geojson,
      );

    const projectFn = (lonLat) => projection(lonLat);

    const preprocessor = new GeometryPreprocessor(projectFn);
    const shapeDataList = preprocessor.flattenFeatureCollection(geojson);

    this.shapes = shapeDataList.map((shapeData) => ({
      ...shapeData,
      rings: shapeData.rings.map((ring) =>
        ring.map(([x, y]) => [
          (x - this.width / 2) * CONFIG.ZOOM,
          (this.height / 2 - y) * CONFIG.ZOOM,
        ]),
      ),
    }));
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

  render() {
    this.context.clearRect(0, 0, this.width, this.height);
    this.context.strokeStyle = `rgb(${CONFIG.COLOR.r}, ${CONFIG.COLOR.g}, ${CONFIG.COLOR.b})`;
    this.context.lineWidth = CONFIG.LINE_WIDTH;

    for (const shape of this.shapes) {
      this.context.beginPath();
      for (const ring of shape.rings) {
        ring.forEach(([dx, dy], i) => {
          const { x: px, y: py } = this.applyCanvasOffset(dx, dy);
          if (i === 0) this.context.moveTo(px, py);
          else this.context.lineTo(px, py);
        });
        if (shape.isClosed) this.context.closePath();
      }
      this.context.stroke();
    }
  }
}

const file = "/data/lower_man.geo.json";

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
  const features = geojson.features.filter(
    (f) => f.properties.Feat_Type !== "Infrastructure",
  );

  const smallGeojson = {
    ...geojson,
    features,
  };

  const app = new MapRenderer("canvas", smallGeojson);
  app.render();
});
