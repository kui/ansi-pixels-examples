/* global Intl */

import fs from 'fs';
import zlib from 'zlib';

import { PNG } from 'node-png';
import byline from 'byline';
import through from 'through2';
import bluebird from 'bluebird';
import mkdirp from 'mkdirp';
import escapeHtml from 'escape-html';

const inflateAsync = bluebird.promisify(zlib.inflate);
const mkdirpAsync = bluebird.promisify(mkdirp);
const Promise = bluebird;

const DATA_TSV = `${__dirname}/ansi-pixels.tsv`;
const PY_URL = 'https://raw.githubusercontent.com/kui/ansi_pixels/master/tool/ansi-pixels.py';

async function main() {
  await mkdirpAsync('img');
  const examples = await buildAllExamples();
  await buildPage(examples);
}

const pngPromises = [];

async function buildAllExamples() {
  const pxData = await new Promise((resolve, reject) => {
    const data = [];
    byline(fs.createReadStream(DATA_TSV))
      .pipe(buildPng())
      .on('data', (o) => data.push(o))
      .on('error', reject)
      .on('end',  () => resolve(data));
  });
  await Promise.all(pngPromises);
  return pxData;
}

async function buildPage(examples) {
  const stream = fs.createWriteStream('index.html');
  const monoFont = `Consolas, 'Courier New', Courier, Monaco, monospace`;
  stream.write(`
<meta charset="utf8">
<link rel="shortcut icon" href="favicon.png" type="image/png">
<title>ANSI Pixels Examples</title>
<style>
body {
  color: white;
  background-color: #333;
}
a { color: #99f; }
p.terminal {
  width: 100%;
  font-family: ${monoFont};
}
p.terminal > input {
  color: white;
  width: calc(100% - 3em);
  background-color: transparent;
  border: black 0px solid;
  font-family: ${monoFont};
}
</style>

<header>
  <h1>ANSI Pixels Examples</h1>
  <p>Example arts with
    <a href="https://kui.github.io/ansi_pixels/">ANSI Pixels</a></p>
</header>
`);
  for (const i in examples) {
    const e = examples[i];
    const cmd = escapeHtml(`python -c "$(curl -s ${PY_URL})" '${e.base64}'`);
    stream.write(`
<div>
  <h2>${e.title}</h2>
  <p class="terminal">
    $ <input readonly value="${cmd}" onfocus="this.select();">
    <br>
    <img class="px-img" src="${e.path}">
    <a href="https://kui.github.io/ansi_pixels/#${e.base64}">Edit this</a>
  </p>
</div>
`);
  }
  stream.write(`
<footer>
  <p><small>Copyright © ${toYear(new Date())} - Keiichiro Ui</small></p>
</footer>
<a href="https://github.com/kui/ansi-pixels-examples"><img style="position: absolute; top: 0; right: 0; border: 0;" src="https://camo.githubusercontent.com/365986a132ccd6a44c23a9169022c0b5c890c387/68747470733a2f2f73332e616d617a6f6e6177732e636f6d2f6769746875622f726962626f6e732f666f726b6d655f72696768745f7265645f6161303030302e706e67" alt="Fork me on GitHub" data-canonical-src="https://s3.amazonaws.com/github/ribbons/forkme_right_red_aa0000.png"></a>
`);
  await bluebird.promisify(stream.end.bind(stream));
}

const YEAR_DF = new Intl.DateTimeFormat('en', { year: 'numeric' });

function toYear(d) {
  return YEAR_DF.format(d);
}

function buildPng() {
  let i = 0;
  return through.obj(async (line, encode, cb) => {
    line = line.toString();
    const pngPath = `img/${i++}.png`;
    let px;
    try {
      px = await parseLine(line);
      pngPromises.push(
        writePng(pngPath, px).then(
          () => console.log(`Write png: ${px.title} => ${pngPath}`)
        )
      );
      px.path = pngPath;
    } catch (e) {
      cb(e);
      return;
    }
    cb(null, px);
  });
}

async function parseLine(line) {
  const [title, b64] = line.split('\t');
  const px = await parseBase64(b64);
  px.title = title;
  px.base64 = b64;
  return px;
}

async function writePng(pngPath, px) {
  const pixels = new AnsiPixels(
    px.pixels[0].length, px.pixels.length, px.pixelSize);
  px.pixels.forEach((row, y) => {
    row.forEach((code, x) => {
      pixels.setWithAnsi(x, y, code && parseInt(code));
    });
  });
  await pixels.dumpPng(pngPath);
}

async function parseBase64(b64) {
  const zipped = decodePixelsData(b64);
  const json = await inflateAsync(zipped);
  return JSON.parse(json);
}

function decodePixelsData(b64) {
  return new Buffer(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

class Pixels {
  constructor(hPixels, vPixels, pixelSize) {
    this.pixelSize = pixelSize;
    this.width  = pixelSize * hPixels;
    this.height = pixelSize * vPixels;
    this.png = new PNG({
      width: this.width,
      height: this.height
    });
  }

  set(xPx, yPx, colors) {
    const x = xPx * this.pixelSize;
    const y = yPx * this.pixelSize;
    for (let i = 0; i < this.pixelSize; i++) {
      for (let j = 0; j < this.pixelSize; j++) {
        this._set(x + i, y + j, colors);
      }
    }
  }

  _set(x, y, colors) {
    const i = (x + this.width * y) * 4;
    if (colors) {
      this.png.data[i + 0] = colors.red || 0;
      this.png.data[i + 1] = colors.green || 0;
      this.png.data[i + 2] = colors.blue || 0;
      this.png.data[i + 3] = colors.alpha || 255;
    } else {
      this.png.data[i + 0] = 0;
      this.png.data[i + 1] = 0;
      this.png.data[i + 2] = 0;
      this.png.data[i + 3] = 0;
    }
  }

  async dumpPng(pngPath) {
    await new Promise((resolve, reject) => {
      this.png.pack()
        .pipe(fs.createWriteStream(pngPath))
        .on('error', reject)
        .on('close', resolve);
    });
  }
}

const ANSI18_CODES = {
  0: { red:   0, green:   0, blue:   0 },
  1: { red: 204, green:   0, blue:   0 },
  2: { red:   0, green: 204, blue:   0 },
  3: { red: 204, green: 204, blue:   0 },
  4: { red:   0, green:   0, blue: 204 },
  5: { red: 204, green:   0, blue: 204 },
  6: { red:   0, green: 204, blue: 204 },
  7: { red: 204, green: 204, blue: 204 },

  8:  { red: 102, green: 102, blue: 102 },
  9:  { red: 255, green: 102, blue: 102 },
  10: { red: 102, green: 255, blue: 102 },
  11: { red: 255, green: 255, blue: 102 },
  12: { red: 102, green: 102, blue: 255 },
  13: { red: 255, green: 102, blue: 255 },
  14: { red: 102, green: 255, blue: 255 },
  15: { red: 255, green: 255, blue: 255 }
};

class AnsiPixels extends Pixels {
  setWithAnsi(x, y, code) {
    if (code === null || code === undefined) {
      this.set(x, y, null);
    } else if (0   <= code && code <= 15) {
      this.set(x, y, ANSI18_CODES[code]);
    } else if (16  <= code && code <= 231) {
      this.set(x, y, getRGB(code));
    } else if (232 <= code && code <= 255) {
      this.set(x, y, getGray(code));
    } else {
      throw Error(`Invalid ANSI code: ${code}`);
    }
  }
}

const RGB_STEP = 255 / 5;

function getRGB(code) {
  const base = code - 16;
  const gb = base % 36;
  const red = Math.floor(base / 36) * RGB_STEP;
  const green = Math.floor(gb / 6) * RGB_STEP;
  const blue = gb % 6 * RGB_STEP;
  return { red, green, blue };
}

const GRAY_STEP = 100 / (255 - 232);

function getGray(code) {
  const g = Math.round((code - 232) * GRAY_STEP);
  return { red: g, green: g, blue: g };
}

main().then(
  ()  => console.log('Done'),
  (e) => console.log(e.stack)
);
