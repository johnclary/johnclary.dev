// Configuration
const CONFIG = {
  NUM_STARS: window.innerWidth <= 768 ? 200 : 400,
  DISTANCE: -100000,
  INIT_MAX_Z: 500,
  ALPHA_SCALE_DOMAIN: 500,
  Z_INCREMENT: 1,
  FRAME_SLEEP: 40,
  RADIUS_MAX_INIT: window.innerWidth <= 768 ? 10 : 30,
  RADIUS_INCREMENT: 0.02,
  TEXT_BOX_PADDING: 10,
  COLORS: {
    STAR: { r: 94, g: 255, b: 137 },
    TEXT: { r: 255, g: 0, b: 191 },
  },
};

class StarfieldAnimation {
  constructor() {
    this.initializeCanvas();
    this.initializeTextBounds();
    this.initializeScales();
    this.stars = this.createStarArray();
    this.then = performance.now();
    this.colorCache = new Map();
  }

  initializeCanvas() {
    const { width, height } = document.body.getBoundingClientRect();
    this.width = width;
    this.height = height;

    this.canvas = d3
      .select("canvas")
      .attr("height", height)
      .attr("width", width);
    this.context = this.canvas.node().getContext("2d");
  }

  initializeTextBounds() {
    const textBounds = document
      .getElementById("header")
      .getBoundingClientRect();
    this.textBbox = turf.bboxPolygon([
      textBounds.left - CONFIG.TEXT_BOX_PADDING,
      textBounds.top - CONFIG.TEXT_BOX_PADDING,
      textBounds.right + CONFIG.TEXT_BOX_PADDING,
      textBounds.bottom,
    ]);
  }

  initializeScales() {
    this.alphaScale = d3
      .scaleLinear()
      .domain([0, CONFIG.ALPHA_SCALE_DOMAIN])
      .range([0, 1]);
  }

  createStarArray() {
    return Array.from({ length: CONFIG.NUM_STARS }, (_, i) => ({
      ...this.createRandomStar(true),
      id: i,
      intersected: false,
    }));
  }

  createRandomStar(init = false) {
    const x = Math.floor(Math.random() * (this.width / 2)) * this.randomSign();
    const y = Math.floor(Math.random() * (this.height / 2)) * this.randomSign();
    const r = Math.random() * CONFIG.RADIUS_MAX_INIT;
    const z = init ? Math.random() * CONFIG.INIT_MAX_Z : 0;

    return { x, y, r, z };
  }

  randomSign() {
    return Math.random() < 0.5 ? -1 : 1;
  }

  projectStar(star) {
    const perspective = CONFIG.DISTANCE / (star.z + CONFIG.DISTANCE);
    return {
      x: star.x * perspective,
      y: star.y * perspective,
    };
  }

  applyCanvasOffset(star) {
    return {
      x: star.x + this.width / 2,
      y: this.height / 2 - star.y,
    };
  }

  isStarIntersecting(screenPos) {
    const point = turf.point([screenPos.x, screenPos.y]);
    return turf.booleanContains(this.textBbox, point);
  }

  isStarOffscreen(star) {
    const margin = CONFIG.RADIUS_MAX_INIT;
    return (
      Math.abs(star.x) > this.width / 2 + margin ||
      Math.abs(star.y) > this.height / 2 + margin
    );
  }

  getStarColor(isIntersected, alpha) {
    const color = isIntersected ? CONFIG.COLORS.TEXT : CONFIG.COLORS.STAR;
    const key = `${color.r},${color.g},${color.b},${alpha}`;

    if (!this.colorCache.has(key)) {
      this.colorCache.set(
        key,
        `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`
      );
    }

    return this.colorCache.get(key);
  }

  updateStars() {
    this.stars.forEach((star, i) => {
      // Move star forward
      star.z += CONFIG.Z_INCREMENT;
      star.r += CONFIG.RADIUS_INCREMENT;

      // Reset offscreen stars
      if (this.isStarOffscreen(star)) {
        const newStar = this.createRandomStar(false);
        Object.assign(star, newStar, {
          id: i,
          intersected: false,
        });
      } else {
        // Project to screen coordinates
        const projected = this.projectStar(star);
        star.x = projected.x;
        star.y = projected.y;
      }

      // Update alpha and intersection status
      star.alpha = this.alphaScale(star.z);
      const screenPos = this.applyCanvasOffset(star);
      star.intersected = star.intersected || this.isStarIntersecting(screenPos);
    });
  }

  renderStars() {
    this.stars.forEach((star) => {
      if (star.r <= 1) return; // Skip tiny stars

      const screenPos = this.applyCanvasOffset(star);
      const color = this.getStarColor(star.intersected, star.alpha);

      this.context.strokeStyle = color;
      this.context.beginPath();
      this.context.arc(screenPos.x, screenPos.y, star.r, 0, 2 * Math.PI);
      this.context.stroke();
    });
  }

  animate() {
    const now = performance.now();
    const elapsed = now - this.then;

    if (elapsed < CONFIG.FRAME_SLEEP) {
      requestAnimationFrame(() => this.animate());
      return;
    }

    // Clear and update
    this.context.clearRect(0, 0, this.width, this.height);
    this.updateStars();
    this.renderStars();

    // Prepare for next frame
    this.then = now - (elapsed % CONFIG.FRAME_SLEEP);
    requestAnimationFrame(() => this.animate());
  }

  start() {
    this.animate();
  }
}

// Initialize and start the animation
const starfield = new StarfieldAnimation();
starfield.start();
