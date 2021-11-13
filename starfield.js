const { width, height } = document.body.getBoundingClientRect();
const isMobile = width <= 768;
const NUM_STARS = isMobile ? 200 : 400;
const DISTANCE = -100000; // max project distance from viewer
const INIT_MAX_Z_VAL = 500; // largest initial poroximity of generated stars
const ALPHA_SCALE_DOMAIN = 500;
const Z_INCREMENT = 1;
const FRAME_SLEEP = 40;
const RADIUS_MAX_INIT = isMobile ? 10 : 30; // maximum star radius
const RADIUS_INCREMENT = .02;
const STAR_COLOR = { r: 94, g: 255, b: 137 };
const TEXT_BOX_PADDING = 10;
const TEXT_COLOR = { r: 255, g: 0, b: 191 };


const textBounds = document.getElementById("header").getBoundingClientRect();
const textBbox = turf.bboxPolygon([
  textBounds.left - TEXT_BOX_PADDING,
  textBounds.top - TEXT_BOX_PADDING,
  textBounds.right + TEXT_BOX_PADDING,
  textBounds.bottom,
]);

const starIntersects = ({ x, y }) => {
  const point = turf.point([x, y]);
  return turf.booleanContains(textBbox, point);
};

function reProject(star) {
  // see: https://math.stackexchange.com/questions/2337183/one-point-perspective-formula
  const x = star.x * (DISTANCE / (star.z + DISTANCE));
  const y = star.y * (DISTANCE / (star.z + DISTANCE));
  return { x: x, y: y };
}

function applyOffset(star, xOffset, yOffset) {
  return { x: star.x + xOffset, y: yOffset - star.y };
}

function adjustStars(stars, width, height) {
  const alphaScale = d3
    .scaleLinear()
    .domain([0, ALPHA_SCALE_DOMAIN])
    .range([0, 1]);

  return stars.map(function (star, i) {
    let newStar;

    if (
      Math.abs(star.x) > width / 2 + RADIUS_MAX_INIT ||
      Math.abs(star.y) > height / 2 + RADIUS_MAX_INIT
    ) {
      //  remove stars that have moved offscreen and replace with a new random one
      newStar = randomStar();
      star.r = newStar.r;
      star.z = newStar.z;
      star.label = newStar.label;
      star.id = i;
      star.intersected = false;
    } else {
      star.z += Z_INCREMENT;
      newStar = reProject(star);
      star.r += RADIUS_INCREMENT
    }

    star.x = newStar.x;
    star.y = newStar.y;
    star.a = alphaScale(star.z);
    return star;
  });
}

function plusOrMinus() {
  // return 1 or -1
  return Math.random() < 0.5 ? -1 : 1;
}

function randomStar(init) {
  const xMult = plusOrMinus();
  const yMult = plusOrMinus();
  const x = Math.floor(Math.random() * (width / 2)) * xMult;
  const y = Math.floor(Math.random() * (height / 2)) * yMult;
  const r = Math.random() * RADIUS_MAX_INIT;
  // we set a large random swath of z vals on the init (otherwise it would take a while for stars to come into view)
  const z = init ? Math.random() * INIT_MAX_Z_VAL : 0;
  return { x: x, y: y, r: r, z: z };
}

function starArray() {
  let stars = new Array(NUM_STARS);
  for (let i = 0; i < NUM_STARS; i++) {
    stars[i] = this.randomStar(true);
    stars[i].i = i;
  }
  return stars;
}

const canvas = d3.select("canvas").attr("height", height).attr("width", width);
const context = canvas.node().getContext("2d");
let then = window.performance.now();
let stars = starArray();

const main = () => {
  let now = window.performance.now();
  const elapsed = now - then;
  if (elapsed < FRAME_SLEEP) {
    window.requestAnimationFrame(main);
    return;
  }

  context.clearRect(0, 0, width, height);

  stars = adjustStars(stars, width, height);
  
  stars.forEach((star) => {
    let offset = applyOffset(star, width / 2, height / 2);
    star.intersected = star.intersected ? true : starIntersects(offset);
    if (star.r > 1) {
      // coordinates are stored as if on a plane w/ center origin (0,0)
      // we adjust them here for a plane whose origin is top left with (minWidth, minHeight)
      context.strokeStyle = `rgba(${STAR_COLOR.r},${STAR_COLOR.g},${STAR_COLOR.b},${star.a} )`;
      if (star.intersected) {
        context.strokeStyle = `rgba(${TEXT_COLOR.r},${TEXT_COLOR.g},${TEXT_COLOR.b},${star.a} )`;
      }
      context.beginPath();
      context.arc(offset.x, offset.y, star.r, 0, 2 * Math.PI);
      context.stroke();
    } else {
      // save some cpu and traw tiny rects instead of tiny circles
      context.fillStyle = "rgba(" + STAR_COLOR + ", " + star.a + ")";
      context.fillRect(offset.x, offset.y, 1, 1);
    }
    star.r = star.r + 0.02;
  });


  then = now - (elapsed % FRAME_SLEEP);
  window.requestAnimationFrame(main);
};

window.requestAnimationFrame(main);
