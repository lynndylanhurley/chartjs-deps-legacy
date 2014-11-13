// Copyright 2006 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


// Known Issues:
//
// * Patterns only support repeat.
// * Radial gradient are not implemented. The VML version of these look very
//   different from the canvas one.
// * Clipping paths are not implemented.
// * Coordsize. The width and height attribute have higher priority than the
//   width and height style values which isn't correct.
// * Painting mode isn't implemented.
// * Canvas width/height should is using content-box by default. IE in
//   Quirks mode will draw the canvas using border-box. Either change your
//   doctype to HTML5
//   (http://www.whatwg.org/specs/web-apps/current-work/#the-doctype)
//   or use Box Sizing Behavior from WebFX
//   (http://webfx.eae.net/dhtml/boxsizing/boxsizing.html)
// * Non uniform scaling does not correctly scale strokes.
// * Optimize. There is always room for speed improvements.

// Only add this code if we do not already have a canvas implementation
if (!document.createElement('canvas').getContext) {

(function() {

  // alias some functions to make (compiled) code shorter
  var m = Math;
  var mr = m.round;
  var ms = m.sin;
  var mc = m.cos;
  var abs = m.abs;
  var sqrt = m.sqrt;

  // this is used for sub pixel precision
  var Z = 10;
  var Z2 = Z / 2;

  var IE_VERSION = +navigator.userAgent.match(/MSIE ([\d.]+)?/)[1];

  /**
   * This funtion is assigned to the <canvas> elements as element.getContext().
   * @this {HTMLElement}
   * @return {CanvasRenderingContext2D_}
   */
  function getContext() {
    return this.context_ ||
        (this.context_ = new CanvasRenderingContext2D_(this));
  }

  var slice = Array.prototype.slice;

  /**
   * Binds a function to an object. The returned function will always use the
   * passed in {@code obj} as {@code this}.
   *
   * Example:
   *
   *   g = bind(f, obj, a, b)
   *   g(c, d) // will do f.call(obj, a, b, c, d)
   *
   * @param {Function} f The function to bind the object to
   * @param {Object} obj The object that should act as this when the function
   *     is called
   * @param {*} var_args Rest arguments that will be used as the initial
   *     arguments when the function is called
   * @return {Function} A new function that has bound this
   */
  function bind(f, obj, var_args) {
    var a = slice.call(arguments, 2);
    return function() {
      return f.apply(obj, a.concat(slice.call(arguments)));
    };
  }

  function encodeHtmlAttribute(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function addNamespace(doc, prefix, urn) {
    if (!doc.namespaces[prefix]) {
      doc.namespaces.add(prefix, urn, '#default#VML');
    }
  }

  function addNamespacesAndStylesheet(doc) {
    addNamespace(doc, 'g_vml_', 'urn:schemas-microsoft-com:vml');
    addNamespace(doc, 'g_o_', 'urn:schemas-microsoft-com:office:office');

    // Setup default CSS.  Only add one style sheet per document
    if (!doc.styleSheets['ex_canvas_']) {
      var ss = doc.createStyleSheet();
      ss.owningElement.id = 'ex_canvas_';
      ss.cssText = 'canvas{display:inline-block;overflow:hidden;' +
          // default size is 300x150 in Gecko and Opera
          'text-align:left;width:300px;height:150px}';
    }
  }

  // Add namespaces and stylesheet at startup.
  addNamespacesAndStylesheet(document);

  var G_vmlCanvasManager_ = {
    init: function(opt_doc) {
      var doc = opt_doc || document;
      // Create a dummy element so that IE will allow canvas elements to be
      // recognized.
      doc.createElement('canvas');
      doc.attachEvent('onreadystatechange', bind(this.init_, this, doc));
    },

    init_: function(doc) {
      // find all canvas elements
      var els = doc.getElementsByTagName('canvas');
      for (var i = 0; i < els.length; i++) {
        this.initElement(els[i]);
      }
    },

    /**
     * Public initializes a canvas element so that it can be used as canvas
     * element from now on. This is called automatically before the page is
     * loaded but if you are creating elements using createElement you need to
     * make sure this is called on the element.
     * @param {HTMLElement} el The canvas element to initialize.
     * @return {HTMLElement} the element that was created.
     */
    initElement: function(el) {
      if (!el.getContext) {
        el.getContext = getContext;

        // Add namespaces and stylesheet to document of the element.
        addNamespacesAndStylesheet(el.ownerDocument);

        // Remove fallback content. There is no way to hide text nodes so we
        // just remove all childNodes. We could hide all elements and remove
        // text nodes but who really cares about the fallback content.
        el.innerHTML = '';

        // do not use inline function because that will leak memory
        el.attachEvent('onpropertychange', onPropertyChange);
        el.attachEvent('onresize', onResize);

        var attrs = el.attributes;
        if (attrs.width && attrs.width.specified) {
          // TODO: use runtimeStyle and coordsize
          // el.getContext().setWidth_(attrs.width.nodeValue);
          el.style.width = attrs.width.nodeValue + 'px';
        } else {
          el.width = el.clientWidth;
        }
        if (attrs.height && attrs.height.specified) {
          // TODO: use runtimeStyle and coordsize
          // el.getContext().setHeight_(attrs.height.nodeValue);
          el.style.height = attrs.height.nodeValue + 'px';
        } else {
          el.height = el.clientHeight;
        }
        //el.getContext().setCoordsize_()
      }
      return el;
    }
  };

  function onPropertyChange(e) {
    var el = e.srcElement;

    switch (e.propertyName) {
      case 'width':
        el.getContext().clearRect();
        el.style.width = el.attributes.width.nodeValue + 'px';
        // In IE8 this does not trigger onresize.
        el.firstChild.style.width =  el.clientWidth + 'px';
        break;
      case 'height':
        el.getContext().clearRect();
        el.style.height = el.attributes.height.nodeValue + 'px';
        el.firstChild.style.height = el.clientHeight + 'px';
        break;
    }
  }

  function onResize(e) {
    var el = e.srcElement;
    if (el.firstChild) {
      el.firstChild.style.width =  el.clientWidth + 'px';
      el.firstChild.style.height = el.clientHeight + 'px';
    }
  }

  G_vmlCanvasManager_.init();

  // precompute "00" to "FF"
  var decToHex = [];
  for (var i = 0; i < 16; i++) {
    for (var j = 0; j < 16; j++) {
      decToHex[i * 16 + j] = i.toString(16) + j.toString(16);
    }
  }

  function createMatrixIdentity() {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
  }

  function matrixMultiply(m1, m2) {
    var result = createMatrixIdentity();

    for (var x = 0; x < 3; x++) {
      for (var y = 0; y < 3; y++) {
        var sum = 0;

        for (var z = 0; z < 3; z++) {
          sum += m1[x][z] * m2[z][y];
        }

        result[x][y] = sum;
      }
    }
    return result;
  }

  function copyState(o1, o2) {
    o2.fillStyle     = o1.fillStyle;
    o2.lineCap       = o1.lineCap;
    o2.lineJoin      = o1.lineJoin;
    o2.lineWidth     = o1.lineWidth;
    o2.miterLimit    = o1.miterLimit;
    o2.shadowBlur    = o1.shadowBlur;
    o2.shadowColor   = o1.shadowColor;
    o2.shadowOffsetX = o1.shadowOffsetX;
    o2.shadowOffsetY = o1.shadowOffsetY;
    o2.strokeStyle   = o1.strokeStyle;
    o2.globalAlpha   = o1.globalAlpha;
    o2.font          = o1.font;
    o2.textAlign     = o1.textAlign;
    o2.textBaseline  = o1.textBaseline;
    o2.arcScaleX_    = o1.arcScaleX_;
    o2.arcScaleY_    = o1.arcScaleY_;
    o2.lineScale_    = o1.lineScale_;
  }

  var colorData = {
    aliceblue: '#F0F8FF',
    antiquewhite: '#FAEBD7',
    aquamarine: '#7FFFD4',
    azure: '#F0FFFF',
    beige: '#F5F5DC',
    bisque: '#FFE4C4',
    black: '#000000',
    blanchedalmond: '#FFEBCD',
    blueviolet: '#8A2BE2',
    brown: '#A52A2A',
    burlywood: '#DEB887',
    cadetblue: '#5F9EA0',
    chartreuse: '#7FFF00',
    chocolate: '#D2691E',
    coral: '#FF7F50',
    cornflowerblue: '#6495ED',
    cornsilk: '#FFF8DC',
    crimson: '#DC143C',
    cyan: '#00FFFF',
    darkblue: '#00008B',
    darkcyan: '#008B8B',
    darkgoldenrod: '#B8860B',
    darkgray: '#A9A9A9',
    darkgreen: '#006400',
    darkgrey: '#A9A9A9',
    darkkhaki: '#BDB76B',
    darkmagenta: '#8B008B',
    darkolivegreen: '#556B2F',
    darkorange: '#FF8C00',
    darkorchid: '#9932CC',
    darkred: '#8B0000',
    darksalmon: '#E9967A',
    darkseagreen: '#8FBC8F',
    darkslateblue: '#483D8B',
    darkslategray: '#2F4F4F',
    darkslategrey: '#2F4F4F',
    darkturquoise: '#00CED1',
    darkviolet: '#9400D3',
    deeppink: '#FF1493',
    deepskyblue: '#00BFFF',
    dimgray: '#696969',
    dimgrey: '#696969',
    dodgerblue: '#1E90FF',
    firebrick: '#B22222',
    floralwhite: '#FFFAF0',
    forestgreen: '#228B22',
    gainsboro: '#DCDCDC',
    ghostwhite: '#F8F8FF',
    gold: '#FFD700',
    goldenrod: '#DAA520',
    grey: '#808080',
    greenyellow: '#ADFF2F',
    honeydew: '#F0FFF0',
    hotpink: '#FF69B4',
    indianred: '#CD5C5C',
    indigo: '#4B0082',
    ivory: '#FFFFF0',
    khaki: '#F0E68C',
    lavender: '#E6E6FA',
    lavenderblush: '#FFF0F5',
    lawngreen: '#7CFC00',
    lemonchiffon: '#FFFACD',
    lightblue: '#ADD8E6',
    lightcoral: '#F08080',
    lightcyan: '#E0FFFF',
    lightgoldenrodyellow: '#FAFAD2',
    lightgreen: '#90EE90',
    lightgrey: '#D3D3D3',
    lightpink: '#FFB6C1',
    lightsalmon: '#FFA07A',
    lightseagreen: '#20B2AA',
    lightskyblue: '#87CEFA',
    lightslategray: '#778899',
    lightslategrey: '#778899',
    lightsteelblue: '#B0C4DE',
    lightyellow: '#FFFFE0',
    limegreen: '#32CD32',
    linen: '#FAF0E6',
    magenta: '#FF00FF',
    mediumaquamarine: '#66CDAA',
    mediumblue: '#0000CD',
    mediumorchid: '#BA55D3',
    mediumpurple: '#9370DB',
    mediumseagreen: '#3CB371',
    mediumslateblue: '#7B68EE',
    mediumspringgreen: '#00FA9A',
    mediumturquoise: '#48D1CC',
    mediumvioletred: '#C71585',
    midnightblue: '#191970',
    mintcream: '#F5FFFA',
    mistyrose: '#FFE4E1',
    moccasin: '#FFE4B5',
    navajowhite: '#FFDEAD',
    oldlace: '#FDF5E6',
    olivedrab: '#6B8E23',
    orange: '#FFA500',
    orangered: '#FF4500',
    orchid: '#DA70D6',
    palegoldenrod: '#EEE8AA',
    palegreen: '#98FB98',
    paleturquoise: '#AFEEEE',
    palevioletred: '#DB7093',
    papayawhip: '#FFEFD5',
    peachpuff: '#FFDAB9',
    peru: '#CD853F',
    pink: '#FFC0CB',
    plum: '#DDA0DD',
    powderblue: '#B0E0E6',
    rosybrown: '#BC8F8F',
    royalblue: '#4169E1',
    saddlebrown: '#8B4513',
    salmon: '#FA8072',
    sandybrown: '#F4A460',
    seagreen: '#2E8B57',
    seashell: '#FFF5EE',
    sienna: '#A0522D',
    skyblue: '#87CEEB',
    slateblue: '#6A5ACD',
    slategray: '#708090',
    slategrey: '#708090',
    snow: '#FFFAFA',
    springgreen: '#00FF7F',
    steelblue: '#4682B4',
    tan: '#D2B48C',
    thistle: '#D8BFD8',
    tomato: '#FF6347',
    turquoise: '#40E0D0',
    violet: '#EE82EE',
    wheat: '#F5DEB3',
    whitesmoke: '#F5F5F5',
    yellowgreen: '#9ACD32'
  };


  function getRgbHslContent(styleString) {
    var start = styleString.indexOf('(', 3);
    var end = styleString.indexOf(')', start + 1);
    var parts = styleString.substring(start + 1, end).split(',');
    // add alpha if needed
    if (parts.length != 4 || styleString.charAt(3) != 'a') {
      parts[3] = 1;
    }
    return parts;
  }

  function percent(s) {
    return parseFloat(s) / 100;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function hslToRgb(parts){
    var r, g, b, h, s, l;
    h = parseFloat(parts[0]) / 360 % 360;
    if (h < 0)
      h++;
    s = clamp(percent(parts[1]), 0, 1);
    l = clamp(percent(parts[2]), 0, 1);
    if (s == 0) {
      r = g = b = l; // achromatic
    } else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hueToRgb(p, q, h + 1 / 3);
      g = hueToRgb(p, q, h);
      b = hueToRgb(p, q, h - 1 / 3);
    }

    return '#' + decToHex[Math.floor(r * 255)] +
        decToHex[Math.floor(g * 255)] +
        decToHex[Math.floor(b * 255)];
  }

  function hueToRgb(m1, m2, h) {
    if (h < 0)
      h++;
    if (h > 1)
      h--;

    if (6 * h < 1)
      return m1 + (m2 - m1) * 6 * h;
    else if (2 * h < 1)
      return m2;
    else if (3 * h < 2)
      return m1 + (m2 - m1) * (2 / 3 - h) * 6;
    else
      return m1;
  }

  var processStyleCache = {};

  function processStyle(styleString) {
    if (styleString in processStyleCache) {
      return processStyleCache[styleString];
    }

    var str, alpha = 1;

    styleString = String(styleString);
    if (styleString.charAt(0) == '#') {
      str = styleString;
    } else if (/^rgb/.test(styleString)) {
      var parts = getRgbHslContent(styleString);
      var str = '#', n;
      for (var i = 0; i < 3; i++) {
        if (parts[i].indexOf('%') != -1) {
          n = Math.floor(percent(parts[i]) * 255);
        } else {
          n = +parts[i];
        }
        str += decToHex[clamp(n, 0, 255)];
      }
      alpha = +parts[3];
    } else if (/^hsl/.test(styleString)) {
      var parts = getRgbHslContent(styleString);
      str = hslToRgb(parts);
      alpha = parts[3];
    } else {
      str = colorData[styleString] || styleString;
    }
    return processStyleCache[styleString] = {color: str, alpha: alpha};
  }

  var DEFAULT_STYLE = {
    style: 'normal',
    variant: 'normal',
    weight: 'normal',
    size: 10,
    family: 'sans-serif'
  };

  // Internal text style cache
  var fontStyleCache = {};

  function processFontStyle(styleString) {
    if (fontStyleCache[styleString]) {
      return fontStyleCache[styleString];
    }

    var el = document.createElement('div');
    var style = el.style;
    try {
      style.font = styleString;
    } catch (ex) {
      // Ignore failures to set to invalid font.
    }

    return fontStyleCache[styleString] = {
      style: style.fontStyle || DEFAULT_STYLE.style,
      variant: style.fontVariant || DEFAULT_STYLE.variant,
      weight: style.fontWeight || DEFAULT_STYLE.weight,
      size: style.fontSize || DEFAULT_STYLE.size,
      family: style.fontFamily || DEFAULT_STYLE.family
    };
  }

  function getComputedStyle(style, element) {
    var computedStyle = {};

    for (var p in style) {
      computedStyle[p] = style[p];
    }

    // Compute the size
    var canvasFontSize = parseFloat(element.currentStyle.fontSize),
        fontSize = parseFloat(style.size);

    if (typeof style.size == 'number') {
      computedStyle.size = style.size;
    } else if (style.size.indexOf('px') != -1) {
      computedStyle.size = fontSize;
    } else if (style.size.indexOf('em') != -1) {
      computedStyle.size = canvasFontSize * fontSize;
    } else if(style.size.indexOf('%') != -1) {
      computedStyle.size = (canvasFontSize / 100) * fontSize;
    } else if (style.size.indexOf('pt') != -1) {
      computedStyle.size = fontSize / .75;
    } else {
      computedStyle.size = canvasFontSize;
    }

    // Different scaling between normal text and VML text. This was found using
    // trial and error to get the same size as non VML text.
    computedStyle.size *= 0.981;

    return computedStyle;
  }

  function buildStyle(style) {
    return style.style + ' ' + style.variant + ' ' + style.weight + ' ' +
        style.size + 'px ' + style.family;
  }

  var lineCapMap = {
    'butt': 'flat',
    'round': 'round'
  };

  function processLineCap(lineCap) {
    return lineCapMap[lineCap] || 'square';
  }

  /**
   * This class implements CanvasRenderingContext2D interface as described by
   * the WHATWG.
   * @param {HTMLElement} canvasElement The element that the 2D context should
   * be associated with
   */
  function CanvasRenderingContext2D_(canvasElement) {
    this.m_ = createMatrixIdentity();

    this.mStack_ = [];
    this.aStack_ = [];
    this.currentPath_ = [];

    // Canvas context properties
    this.strokeStyle = '#000';
    this.fillStyle = '#000';

    this.lineWidth = 1;
    this.lineJoin = 'miter';
    this.lineCap = 'butt';
    this.miterLimit = Z * 1;
    this.globalAlpha = 1;
    this.font = '10px sans-serif';
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
    this.canvas = canvasElement;

    var cssText = 'width:' + canvasElement.clientWidth + 'px;height:' +
        canvasElement.clientHeight + 'px;overflow:hidden;position:absolute';
    var el = canvasElement.ownerDocument.createElement('div');
    el.style.cssText = cssText;
    canvasElement.appendChild(el);

    var overlayEl = el.cloneNode(false);
    // Use a non transparent background.
    overlayEl.style.backgroundColor = 'red';
    overlayEl.style.filter = 'alpha(opacity=0)';
    canvasElement.appendChild(overlayEl);

    this.element_ = el;
    this.arcScaleX_ = 1;
    this.arcScaleY_ = 1;
    this.lineScale_ = 1;
  }

  var contextPrototype = CanvasRenderingContext2D_.prototype;
  contextPrototype.clearRect = function() {
    if (this.textMeasureEl_) {
      this.textMeasureEl_.removeNode(true);
      this.textMeasureEl_ = null;
    }
    this.element_.innerHTML = '';
  };

  contextPrototype.beginPath = function() {
    // TODO: Branch current matrix so that save/restore has no effect
    //       as per safari docs.
    this.currentPath_ = [];
  };

  contextPrototype.moveTo = function(aX, aY) {
    var p = getCoords(this, aX, aY);
    this.currentPath_.push({type: 'moveTo', x: p.x, y: p.y});
    this.currentX_ = p.x;
    this.currentY_ = p.y;
  };

  contextPrototype.lineTo = function(aX, aY) {
    var p = getCoords(this, aX, aY);
    this.currentPath_.push({type: 'lineTo', x: p.x, y: p.y});

    this.currentX_ = p.x;
    this.currentY_ = p.y;
  };

  contextPrototype.bezierCurveTo = function(aCP1x, aCP1y,
                                            aCP2x, aCP2y,
                                            aX, aY) {
    var p = getCoords(this, aX, aY);
    var cp1 = getCoords(this, aCP1x, aCP1y);
    var cp2 = getCoords(this, aCP2x, aCP2y);
    bezierCurveTo(this, cp1, cp2, p);
  };

  // Helper function that takes the already fixed cordinates.
  function bezierCurveTo(self, cp1, cp2, p) {
    self.currentPath_.push({
      type: 'bezierCurveTo',
      cp1x: cp1.x,
      cp1y: cp1.y,
      cp2x: cp2.x,
      cp2y: cp2.y,
      x: p.x,
      y: p.y
    });
    self.currentX_ = p.x;
    self.currentY_ = p.y;
  }

  contextPrototype.quadraticCurveTo = function(aCPx, aCPy, aX, aY) {
    // the following is lifted almost directly from
    // http://developer.mozilla.org/en/docs/Canvas_tutorial:Drawing_shapes

    var cp = getCoords(this, aCPx, aCPy);
    var p = getCoords(this, aX, aY);

    var cp1 = {
      x: this.currentX_ + 2.0 / 3.0 * (cp.x - this.currentX_),
      y: this.currentY_ + 2.0 / 3.0 * (cp.y - this.currentY_)
    };
    var cp2 = {
      x: cp1.x + (p.x - this.currentX_) / 3.0,
      y: cp1.y + (p.y - this.currentY_) / 3.0
    };

    bezierCurveTo(this, cp1, cp2, p);
  };

  contextPrototype.arc = function(aX, aY, aRadius,
                                  aStartAngle, aEndAngle, aClockwise) {
    aRadius *= Z;
    var arcType = aClockwise ? 'at' : 'wa';

    var xStart = aX + mc(aStartAngle) * aRadius - Z2;
    var yStart = aY + ms(aStartAngle) * aRadius - Z2;

    var xEnd = aX + mc(aEndAngle) * aRadius - Z2;
    var yEnd = aY + ms(aEndAngle) * aRadius - Z2;

    // IE won't render arches drawn counter clockwise if xStart == xEnd.
    if (xStart == xEnd && !aClockwise) {
      xStart += 0.125; // Offset xStart by 1/80 of a pixel. Use something
                       // that can be represented in binary
    }

    var p = getCoords(this, aX, aY);
    var pStart = getCoords(this, xStart, yStart);
    var pEnd = getCoords(this, xEnd, yEnd);

    this.currentPath_.push({type: arcType,
                           x: p.x,
                           y: p.y,
                           radius: aRadius,
                           xStart: pStart.x,
                           yStart: pStart.y,
                           xEnd: pEnd.x,
                           yEnd: pEnd.y});

  };

  contextPrototype.rect = function(aX, aY, aWidth, aHeight) {
    this.moveTo(aX, aY);
    this.lineTo(aX + aWidth, aY);
    this.lineTo(aX + aWidth, aY + aHeight);
    this.lineTo(aX, aY + aHeight);
    this.closePath();
  };

  contextPrototype.strokeRect = function(aX, aY, aWidth, aHeight) {
    var oldPath = this.currentPath_;
    this.beginPath();

    this.moveTo(aX, aY);
    this.lineTo(aX + aWidth, aY);
    this.lineTo(aX + aWidth, aY + aHeight);
    this.lineTo(aX, aY + aHeight);
    this.closePath();
    this.stroke();

    this.currentPath_ = oldPath;
  };

  contextPrototype.fillRect = function(aX, aY, aWidth, aHeight) {
    var oldPath = this.currentPath_;
    this.beginPath();

    this.moveTo(aX, aY);
    this.lineTo(aX + aWidth, aY);
    this.lineTo(aX + aWidth, aY + aHeight);
    this.lineTo(aX, aY + aHeight);
    this.closePath();
    this.fill();

    this.currentPath_ = oldPath;
  };

  contextPrototype.createLinearGradient = function(aX0, aY0, aX1, aY1) {
    var gradient = new CanvasGradient_('gradient');
    gradient.x0_ = aX0;
    gradient.y0_ = aY0;
    gradient.x1_ = aX1;
    gradient.y1_ = aY1;
    return gradient;
  };

  contextPrototype.createRadialGradient = function(aX0, aY0, aR0,
                                                   aX1, aY1, aR1) {
    var gradient = new CanvasGradient_('gradientradial');
    gradient.x0_ = aX0;
    gradient.y0_ = aY0;
    gradient.r0_ = aR0;
    gradient.x1_ = aX1;
    gradient.y1_ = aY1;
    gradient.r1_ = aR1;
    return gradient;
  };

  contextPrototype.drawImage = function(image, var_args) {
    var dx, dy, dw, dh, sx, sy, sw, sh;

    // to find the original width we overide the width and height
    var oldRuntimeWidth = image.runtimeStyle.width;
    var oldRuntimeHeight = image.runtimeStyle.height;
    image.runtimeStyle.width = 'auto';
    image.runtimeStyle.height = 'auto';

    // get the original size
    var w = image.width;
    var h = image.height;

    // and remove overides
    image.runtimeStyle.width = oldRuntimeWidth;
    image.runtimeStyle.height = oldRuntimeHeight;

    if (arguments.length == 3) {
      dx = arguments[1];
      dy = arguments[2];
      sx = sy = 0;
      sw = dw = w;
      sh = dh = h;
    } else if (arguments.length == 5) {
      dx = arguments[1];
      dy = arguments[2];
      dw = arguments[3];
      dh = arguments[4];
      sx = sy = 0;
      sw = w;
      sh = h;
    } else if (arguments.length == 9) {
      sx = arguments[1];
      sy = arguments[2];
      sw = arguments[3];
      sh = arguments[4];
      dx = arguments[5];
      dy = arguments[6];
      dw = arguments[7];
      dh = arguments[8];
    } else {
      throw Error('Invalid number of arguments');
    }

    var d = getCoords(this, dx, dy);

    var w2 = sw / 2;
    var h2 = sh / 2;

    var vmlStr = [];

    var W = 10;
    var H = 10;

    // For some reason that I've now forgotten, using divs didn't work
    vmlStr.push(' <g_vml_:group',
                ' coordsize="', Z * W, ',', Z * H, '"',
                ' coordorigin="0,0"' ,
                ' style="width:', W, 'px;height:', H, 'px;position:absolute;');

    // If filters are necessary (rotation exists), create them
    // filters are bog-slow, so only create them if abbsolutely necessary
    // The following check doesn't account for skews (which don't exist
    // in the canvas spec (yet) anyway.

    if (this.m_[0][0] != 1 || this.m_[0][1] ||
        this.m_[1][1] != 1 || this.m_[1][0]) {
      var filter = [];

      // Note the 12/21 reversal
      filter.push('M11=', this.m_[0][0], ',',
                  'M12=', this.m_[1][0], ',',
                  'M21=', this.m_[0][1], ',',
                  'M22=', this.m_[1][1], ',',
                  'Dx=', mr(d.x / Z), ',',
                  'Dy=', mr(d.y / Z), '');

      // Bounding box calculation (need to minimize displayed area so that
      // filters don't waste time on unused pixels.
      var max = d;
      var c2 = getCoords(this, dx + dw, dy);
      var c3 = getCoords(this, dx, dy + dh);
      var c4 = getCoords(this, dx + dw, dy + dh);

      max.x = m.max(max.x, c2.x, c3.x, c4.x);
      max.y = m.max(max.y, c2.y, c3.y, c4.y);

      vmlStr.push('padding:0 ', mr(max.x / Z), 'px ', mr(max.y / Z),
                  'px 0;filter:progid:DXImageTransform.Microsoft.Matrix(',
                  filter.join(''), ", sizingmethod='clip');");

    } else {
      vmlStr.push('top:', mr(d.y / Z), 'px;left:', mr(d.x / Z), 'px;');
    }

    vmlStr.push(' ">' ,
                '<g_vml_:image src="', image.src, '"',
                ' style="width:', Z * dw, 'px;',
                ' height:', Z * dh, 'px"',
                ' cropleft="', sx / w, '"',
                ' croptop="', sy / h, '"',
                ' cropright="', (w - sx - sw) / w, '"',
                ' cropbottom="', (h - sy - sh) / h, '"',
                ' />',
                '</g_vml_:group>');

    this.element_.insertAdjacentHTML('BeforeEnd', vmlStr.join(''));
  };

  contextPrototype.stroke = function(aFill) {
    var lineStr = [];
    var lineOpen = false;

    var W = 10;
    var H = 10;

    lineStr.push('<g_vml_:shape',
                 ' filled="', !!aFill, '"',
                 ' style="position:absolute;width:', W, 'px;height:', H, 'px;"',
                 ' coordorigin="0,0"',
                 ' coordsize="', Z * W, ',', Z * H, '"',
                 ' stroked="', !aFill, '"',
                 ' path="');

    var newSeq = false;
    var min = {x: null, y: null};
    var max = {x: null, y: null};

    for (var i = 0; i < this.currentPath_.length; i++) {
      var p = this.currentPath_[i];
      var c;

      switch (p.type) {
        case 'moveTo':
          c = p;
          lineStr.push(' m ', mr(p.x), ',', mr(p.y));
          break;
        case 'lineTo':
          lineStr.push(' l ', mr(p.x), ',', mr(p.y));
          break;
        case 'close':
          lineStr.push(' x ');
          p = null;
          break;
        case 'bezierCurveTo':
          lineStr.push(' c ',
                       mr(p.cp1x), ',', mr(p.cp1y), ',',
                       mr(p.cp2x), ',', mr(p.cp2y), ',',
                       mr(p.x), ',', mr(p.y));
          break;
        case 'at':
        case 'wa':
          lineStr.push(' ', p.type, ' ',
                       mr(p.x - this.arcScaleX_ * p.radius), ',',
                       mr(p.y - this.arcScaleY_ * p.radius), ' ',
                       mr(p.x + this.arcScaleX_ * p.radius), ',',
                       mr(p.y + this.arcScaleY_ * p.radius), ' ',
                       mr(p.xStart), ',', mr(p.yStart), ' ',
                       mr(p.xEnd), ',', mr(p.yEnd));
          break;
      }


      // TODO: Following is broken for curves due to
      //       move to proper paths.

      // Figure out dimensions so we can do gradient fills
      // properly
      if (p) {
        if (min.x == null || p.x < min.x) {
          min.x = p.x;
        }
        if (max.x == null || p.x > max.x) {
          max.x = p.x;
        }
        if (min.y == null || p.y < min.y) {
          min.y = p.y;
        }
        if (max.y == null || p.y > max.y) {
          max.y = p.y;
        }
      }
    }
    lineStr.push(' ">');

    if (!aFill) {
      appendStroke(this, lineStr);
    } else {
      appendFill(this, lineStr, min, max);
    }

    lineStr.push('</g_vml_:shape>');

    this.element_.insertAdjacentHTML('beforeEnd', lineStr.join(''));
  };

  function appendStroke(ctx, lineStr) {
    var a = processStyle(ctx.strokeStyle);
    var color = a.color;
    var opacity = a.alpha * ctx.globalAlpha;
    var lineWidth = ctx.lineScale_ * ctx.lineWidth;

    // VML cannot correctly render a line if the width is less than 1px.
    // In that case, we dilute the color to make the line look thinner.
    if (lineWidth < 1) {
      opacity *= lineWidth;
    }

    lineStr.push(
      '<g_vml_:stroke',
      ' opacity="', opacity, '"',
      ' joinstyle="', ctx.lineJoin, '"',
      ' miterlimit="', ctx.miterLimit, '"',
      ' endcap="', processLineCap(ctx.lineCap), '"',
      ' weight="', lineWidth, 'px"',
      ' color="', color, '" />'
    );
  }

  function appendFill(ctx, lineStr, min, max) {
    var fillStyle = ctx.fillStyle;
    var arcScaleX = ctx.arcScaleX_;
    var arcScaleY = ctx.arcScaleY_;
    var width = max.x - min.x;
    var height = max.y - min.y;
    if (fillStyle instanceof CanvasGradient_) {
      // TODO: Gradients transformed with the transformation matrix.
      var angle = 0;
      var focus = {x: 0, y: 0};

      // additional offset
      var shift = 0;
      // scale factor for offset
      var expansion = 1;

      if (fillStyle.type_ == 'gradient') {
        var x0 = fillStyle.x0_ / arcScaleX;
        var y0 = fillStyle.y0_ / arcScaleY;
        var x1 = fillStyle.x1_ / arcScaleX;
        var y1 = fillStyle.y1_ / arcScaleY;
        var p0 = getCoords(ctx, x0, y0);
        var p1 = getCoords(ctx, x1, y1);
        var dx = p1.x - p0.x;
        var dy = p1.y - p0.y;
        angle = Math.atan2(dx, dy) * 180 / Math.PI;

        // The angle should be a non-negative number.
        if (angle < 0) {
          angle += 360;
        }

        // Very small angles produce an unexpected result because they are
        // converted to a scientific notation string.
        if (angle < 1e-6) {
          angle = 0;
        }
      } else {
        var p0 = getCoords(ctx, fillStyle.x0_, fillStyle.y0_);
        focus = {
          x: (p0.x - min.x) / width,
          y: (p0.y - min.y) / height
        };

        width  /= arcScaleX * Z;
        height /= arcScaleY * Z;
        var dimension = m.max(width, height);
        shift = 2 * fillStyle.r0_ / dimension;
        expansion = 2 * fillStyle.r1_ / dimension - shift;
      }

      // We need to sort the color stops in ascending order by offset,
      // otherwise IE won't interpret it correctly.
      var stops = fillStyle.colors_;
      stops.sort(function(cs1, cs2) {
        return cs1.offset - cs2.offset;
      });

      var length = stops.length;
      var color1 = stops[0].color;
      var color2 = stops[length - 1].color;
      var opacity1 = stops[0].alpha * ctx.globalAlpha;
      var opacity2 = stops[length - 1].alpha * ctx.globalAlpha;

      var colors = [];
      for (var i = 0; i < length; i++) {
        var stop = stops[i];
        colors.push(stop.offset * expansion + shift + ' ' + stop.color);
      }

      // When colors attribute is used, the meanings of opacity and o:opacity2
      // are reversed.
      lineStr.push('<g_vml_:fill type="', fillStyle.type_, '"',
                   ' method="none" focus="100%"',
                   ' color="', color1, '"',
                   ' color2="', color2, '"',
                   ' colors="', colors.join(','), '"',
                   ' opacity="', opacity2, '"',
                   ' g_o_:opacity2="', opacity1, '"',
                   ' angle="', angle, '"',
                   ' focusposition="', focus.x, ',', focus.y, '" />');
    } else if (fillStyle instanceof CanvasPattern_) {
      if (width && height) {
        var deltaLeft = -min.x;
        var deltaTop = -min.y;
        lineStr.push('<g_vml_:fill',
                     ' position="',
                     deltaLeft / width * arcScaleX * arcScaleX, ',',
                     deltaTop / height * arcScaleY * arcScaleY, '"',
                     ' type="tile"',
                     // TODO: Figure out the correct size to fit the scale.
                     //' size="', w, 'px ', h, 'px"',
                     ' src="', fillStyle.src_, '" />');
       }
    } else {
      var a = processStyle(ctx.fillStyle);
      var color = a.color;
      var opacity = a.alpha * ctx.globalAlpha;
      lineStr.push('<g_vml_:fill color="', color, '" opacity="', opacity,
                   '" />');
    }
  }

  contextPrototype.fill = function() {
    this.stroke(true);
  };

  contextPrototype.closePath = function() {
    this.currentPath_.push({type: 'close'});
  };

  function getCoords(ctx, aX, aY) {
    var m = ctx.m_;
    return {
      x: Z * (aX * m[0][0] + aY * m[1][0] + m[2][0]) - Z2,
      y: Z * (aX * m[0][1] + aY * m[1][1] + m[2][1]) - Z2
    };
  };

  contextPrototype.save = function() {
    var o = {};
    copyState(this, o);
    this.aStack_.push(o);
    this.mStack_.push(this.m_);
    this.m_ = matrixMultiply(createMatrixIdentity(), this.m_);
  };

  contextPrototype.restore = function() {
    if (this.aStack_.length) {
      copyState(this.aStack_.pop(), this);
      this.m_ = this.mStack_.pop();
    }
  };

  function matrixIsFinite(m) {
    return isFinite(m[0][0]) && isFinite(m[0][1]) &&
        isFinite(m[1][0]) && isFinite(m[1][1]) &&
        isFinite(m[2][0]) && isFinite(m[2][1]);
  }

  function setM(ctx, m, updateLineScale) {
    if (!matrixIsFinite(m)) {
      return;
    }
    ctx.m_ = m;

    if (updateLineScale) {
      // Get the line scale.
      // Determinant of this.m_ means how much the area is enlarged by the
      // transformation. So its square root can be used as a scale factor
      // for width.
      var det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
      ctx.lineScale_ = sqrt(abs(det));
    }
  }

  contextPrototype.translate = function(aX, aY) {
    var m1 = [
      [1,  0,  0],
      [0,  1,  0],
      [aX, aY, 1]
    ];

    setM(this, matrixMultiply(m1, this.m_), false);
  };

  contextPrototype.rotate = function(aRot) {
    var c = mc(aRot);
    var s = ms(aRot);

    var m1 = [
      [c,  s, 0],
      [-s, c, 0],
      [0,  0, 1]
    ];

    setM(this, matrixMultiply(m1, this.m_), false);
  };

  contextPrototype.scale = function(aX, aY) {
    this.arcScaleX_ *= aX;
    this.arcScaleY_ *= aY;
    var m1 = [
      [aX, 0,  0],
      [0,  aY, 0],
      [0,  0,  1]
    ];

    setM(this, matrixMultiply(m1, this.m_), true);
  };

  contextPrototype.transform = function(m11, m12, m21, m22, dx, dy) {
    var m1 = [
      [m11, m12, 0],
      [m21, m22, 0],
      [dx,  dy,  1]
    ];

    setM(this, matrixMultiply(m1, this.m_), true);
  };

  contextPrototype.setTransform = function(m11, m12, m21, m22, dx, dy) {
    var m = [
      [m11, m12, 0],
      [m21, m22, 0],
      [dx,  dy,  1]
    ];

    setM(this, m, true);
  };

  /**
   * The text drawing function.
   * The maxWidth argument isn't taken in account, since no browser supports
   * it yet.
   */
  contextPrototype.drawText_ = function(text, x, y, maxWidth, stroke) {
    var m = this.m_,
        delta = 1000,
        left = 0,
        right = delta,
        offset = {x: 0, y: 0},
        lineStr = [];

    var fontStyle = getComputedStyle(processFontStyle(this.font),
                                     this.element_);

    var fontStyleString = buildStyle(fontStyle);

    var elementStyle = this.element_.currentStyle;
    var textAlign = this.textAlign.toLowerCase();
    switch (textAlign) {
      case 'left':
      case 'center':
      case 'right':
        break;
      case 'end':
        textAlign = elementStyle.direction == 'ltr' ? 'right' : 'left';
        break;
      case 'start':
        textAlign = elementStyle.direction == 'rtl' ? 'right' : 'left';
        break;
      default:
        textAlign = 'left';
    }

    // 1.75 is an arbitrary number, as there is no info about the text baseline
    switch (this.textBaseline) {
      case 'hanging':
      case 'top':
        offset.y = fontStyle.size / 1.75;
        break;
      case 'middle':
        break;
      default:
      case null:
      case 'alphabetic':
      case 'ideographic':
      case 'bottom':
        offset.y = -fontStyle.size / 2.25;
        break;
    }

    switch(textAlign) {
      case 'right':
        left = delta;
        right = 0.05;
        break;
      case 'center':
        left = right = delta / 2;
        break;
    }

    var d = getCoords(this, x + offset.x, y + offset.y);

    lineStr.push('<g_vml_:line from="', -left ,' 0" to="', right ,' 0.05" ',
                 ' coordsize="100 100" coordorigin="0 0"',
                 ' filled="', !stroke, '" stroked="', !!stroke,
                 '" style="position:absolute;width:1px;height:1px;">');

    if (stroke) {
      appendStroke(this, lineStr);
    } else {
      // TODO: Fix the min and max params.
      appendFill(this, lineStr, {x: -left, y: 0},
                 {x: right, y: fontStyle.size});
    }

    var skewM = m[0][0].toFixed(3) + ',' + m[1][0].toFixed(3) + ',' +
                m[0][1].toFixed(3) + ',' + m[1][1].toFixed(3) + ',0,0';

    var skewOffset = mr(d.x / Z) + ',' + mr(d.y / Z);

    lineStr.push('<g_vml_:skew on="t" matrix="', skewM ,'" ',
                 ' offset="', skewOffset, '" origin="', left ,' 0" />',
                 '<g_vml_:path textpathok="true" />',
                 '<g_vml_:textpath on="true" string="',
                 encodeHtmlAttribute(text),
                 '" style="v-text-align:', textAlign,
                 ';font:', encodeHtmlAttribute(fontStyleString),
                 '" /></g_vml_:line>');

    this.element_.insertAdjacentHTML('beforeEnd', lineStr.join(''));
  };

  contextPrototype.fillText = function(text, x, y, maxWidth) {
    this.drawText_(text, x, y, maxWidth, false);
  };

  contextPrototype.strokeText = function(text, x, y, maxWidth) {
    this.drawText_(text, x, y, maxWidth, true);
  };

  contextPrototype.measureText = function(text) {
    if (!this.textMeasureEl_) {
      var s = '<span style="position:absolute;' +
          'top:-20000px;left:0;padding:0;margin:0;border:none;' +
          'white-space:pre;"></span>';
      this.element_.insertAdjacentHTML('beforeEnd', s);
      this.textMeasureEl_ = this.element_.lastChild;
    }
    var doc = this.element_.ownerDocument;
    this.textMeasureEl_.innerHTML = '';
    this.textMeasureEl_.style.font = this.font;
    // Don't use innerHTML or innerText because they allow markup/whitespace.
    this.textMeasureEl_.appendChild(doc.createTextNode(text));
    return {width: this.textMeasureEl_.offsetWidth};
  };

  /******** STUBS ********/
  contextPrototype.clip = function() {
    // TODO: Implement
  };

  contextPrototype.arcTo = function() {
    // TODO: Implement
  };

  contextPrototype.createPattern = function(image, repetition) {
    return new CanvasPattern_(image, repetition);
  };

  // Gradient / Pattern Stubs
  function CanvasGradient_(aType) {
    this.type_ = aType;
    this.x0_ = 0;
    this.y0_ = 0;
    this.r0_ = 0;
    this.x1_ = 0;
    this.y1_ = 0;
    this.r1_ = 0;
    this.colors_ = [];
  }

  CanvasGradient_.prototype.addColorStop = function(aOffset, aColor) {
    aColor = processStyle(aColor);
    this.colors_.push({offset: aOffset,
                       color: aColor.color,
                       alpha: aColor.alpha});
  };

  function CanvasPattern_(image, repetition) {
    assertImageIsValid(image);
    switch (repetition) {
      case 'repeat':
      case null:
      case '':
        this.repetition_ = 'repeat';
        break
      case 'repeat-x':
      case 'repeat-y':
      case 'no-repeat':
        this.repetition_ = repetition;
        break;
      default:
        throwException('SYNTAX_ERR');
    }

    this.src_ = image.src;
    this.width_ = image.width;
    this.height_ = image.height;
  }

  function throwException(s) {
    throw new DOMException_(s);
  }

  function assertImageIsValid(img) {
    if (!img || img.nodeType != 1 || img.tagName != 'IMG') {
      throwException('TYPE_MISMATCH_ERR');
    }
    if (img.readyState != 'complete') {
      throwException('INVALID_STATE_ERR');
    }
  }

  function DOMException_(s) {
    this.code = this[s];
    this.message = s +': DOM Exception ' + this.code;
  }
  var p = DOMException_.prototype = new Error;
  p.INDEX_SIZE_ERR = 1;
  p.DOMSTRING_SIZE_ERR = 2;
  p.HIERARCHY_REQUEST_ERR = 3;
  p.WRONG_DOCUMENT_ERR = 4;
  p.INVALID_CHARACTER_ERR = 5;
  p.NO_DATA_ALLOWED_ERR = 6;
  p.NO_MODIFICATION_ALLOWED_ERR = 7;
  p.NOT_FOUND_ERR = 8;
  p.NOT_SUPPORTED_ERR = 9;
  p.INUSE_ATTRIBUTE_ERR = 10;
  p.INVALID_STATE_ERR = 11;
  p.SYNTAX_ERR = 12;
  p.INVALID_MODIFICATION_ERR = 13;
  p.NAMESPACE_ERR = 14;
  p.INVALID_ACCESS_ERR = 15;
  p.VALIDATION_ERR = 16;
  p.TYPE_MISMATCH_ERR = 17;

  // set up externs
  G_vmlCanvasManager = G_vmlCanvasManager_;
  CanvasRenderingContext2D = CanvasRenderingContext2D_;
  CanvasGradient = CanvasGradient_;
  CanvasPattern = CanvasPattern_;
  DOMException = DOMException_;
})();

} // if
if (_typeface_js && _typeface_js.loadFace) _typeface_js.loadFace({"glyphs":{"Î¿":{"x_min":41,"x_max":697,"ha":738,"o":"m 364 -15 q 130 77 219 -15 q 41 321 41 171 q 131 573 41 474 q 371 672 222 672 q 607 574 518 672 q 697 325 697 477 q 606 79 697 174 q 364 -15 515 -15 m 370 619 q 222 530 268 619 q 177 327 177 441 q 223 125 177 216 q 369 34 269 34 q 515 122 470 34 q 560 325 560 210 q 515 529 560 439 q 370 619 471 619 "},"S":{"x_min":49.3125,"x_max":626,"ha":685,"o":"m 87 208 q 176 89 119 132 q 311 46 232 46 q 448 98 389 46 q 508 227 508 150 q 393 400 508 336 q 181 498 287 448 q 67 688 67 566 q 153 880 67 811 q 363 950 239 950 q 471 936 422 950 q 585 891 520 922 q 559 822 571 858 q 541 757 547 786 l 528 757 q 347 897 493 897 q 226 855 276 897 q 177 742 177 813 q 292 580 177 640 q 509 483 400 532 q 626 286 626 414 q 528 69 626 153 q 295 -15 430 -15 q 163 2 224 -15 q 49 59 102 19 q 67 135 61 104 q 73 205 73 166 l 87 208 "},"/":{"x_min":-35.390625,"x_max":396.078125,"ha":376,"o":"m -35 -126 l 333 1025 l 396 1025 l 27 -126 l -35 -126 "},"Î¤":{"x_min":10.78125,"x_max":698.4375,"ha":711,"o":"m 10 838 l 14 884 l 10 926 q 190 926 70 926 q 353 926 310 926 q 533 926 412 926 q 698 926 654 926 q 693 883 693 910 q 693 861 693 870 q 698 834 693 852 q 597 850 653 843 q 493 857 540 857 l 418 857 q 418 767 418 830 q 418 701 418 704 l 418 221 q 432 0 418 122 q 355 8 393 4 q 316 5 337 8 q 283 0 295 3 q 283 132 283 40 q 283 259 283 225 l 283 683 l 283 857 q 10 838 156 857 "},"Ï•":{"x_min":41,"x_max":942,"ha":986,"o":"m 425 -10 q 159 76 277 -10 q 41 316 41 163 q 159 562 41 470 q 425 654 277 654 q 425 838 425 719 q 425 971 425 957 q 456 965 436 968 q 494 963 477 963 q 530 965 511 963 q 568 971 550 968 q 553 654 553 825 q 824 567 706 654 q 942 324 942 481 q 825 79 942 169 q 560 -10 709 -10 q 560 -201 560 -68 q 560 -371 560 -334 q 497 -362 530 -362 q 457 -364 475 -362 q 425 -371 438 -367 q 425 -161 425 -296 q 425 -10 425 -26 m 552 39 q 743 118 677 39 q 809 330 809 198 q 736 523 809 445 q 552 601 664 601 l 552 319 l 552 39 m 432 319 l 432 601 q 248 523 320 601 q 177 330 177 446 q 241 117 177 195 q 432 39 305 39 l 432 319 "},"y":{"x_min":4.078125,"x_max":651.96875,"ha":651,"o":"m 4 653 l 84 647 l 161 653 q 198 536 185 577 q 236 431 210 495 l 356 128 l 464 413 q 541 653 509 537 q 594 647 571 647 q 651 653 620 647 q 408 125 521 388 q 219 -372 295 -137 l 183 -367 q 138 -367 160 -367 q 110 -372 119 -371 l 284 -22 q 4 653 167 294 "},"â‰ˆ":{"x_min":116,"x_max":999,"ha":1116,"o":"m 750 442 q 553 487 686 442 q 369 533 420 533 q 245 506 292 533 q 116 428 199 480 l 116 501 q 241 572 177 545 q 369 600 305 600 q 562 553 430 600 q 750 507 695 507 q 870 534 812 507 q 999 613 928 562 l 999 537 q 874 467 935 493 q 750 442 813 442 m 744 214 q 556 260 688 214 q 369 307 424 307 q 232 273 294 307 q 116 202 170 239 l 116 278 q 242 346 178 320 q 373 372 306 372 q 559 326 437 372 q 750 281 681 281 q 865 305 813 281 q 999 387 917 330 l 999 312 q 876 240 940 266 q 744 214 812 214 "},"Î ":{"x_min":105.84375,"x_max":909.515625,"ha":1016,"o":"m 423 844 l 257 844 q 257 631 257 778 q 257 473 257 484 q 257 235 257 394 q 257 0 257 77 q 224 4 250 0 q 184 8 198 8 q 146 4 173 8 q 114 0 119 0 q 114 239 114 70 q 114 464 114 408 q 114 711 114 620 q 105 926 114 802 q 280 926 163 926 q 455 926 397 926 q 681 926 530 926 q 909 926 833 926 q 900 793 900 870 q 900 659 900 716 l 900 503 q 900 244 900 427 q 900 0 900 62 q 871 4 897 0 q 831 8 845 8 q 795 5 812 8 q 758 0 778 2 q 758 258 758 94 q 758 467 758 421 l 758 729 l 758 844 l 423 844 "},"Î":{"x_min":-41,"x_max":375,"ha":334,"o":"m 98 333 l 98 520 q 98 566 98 544 q 93 653 98 588 q 138 647 127 647 q 161 647 148 647 q 228 653 191 647 q 223 555 223 599 q 223 437 223 511 l 223 406 q 223 194 223 337 q 223 0 223 51 q 197 3 212 1 q 161 6 182 6 q 125 3 145 6 q 98 0 104 1 q 98 165 98 51 q 98 333 98 279 m 17 865 q 59 846 41 865 q 77 804 77 828 q 59 761 77 779 q 17 743 41 743 q -23 761 -5 743 q -41 804 -41 779 q -23 846 -41 828 q 17 865 -5 865 m 168 929 q 184 969 175 956 q 220 982 194 982 q 251 971 238 982 q 264 941 264 961 q 251 904 264 919 l 145 743 l 114 743 l 168 929 m 316 865 q 357 846 339 865 q 375 804 375 828 q 357 761 375 779 q 316 743 339 743 q 274 761 290 743 q 258 804 258 779 q 274 846 258 828 q 316 865 290 865 "},"g":{"x_min":31,"x_max":658,"ha":673,"o":"m 79 123 q 110 201 79 169 q 189 252 141 233 l 189 262 q 94 329 127 278 q 62 447 62 380 q 137 610 62 549 q 316 672 213 672 q 412 661 349 672 q 489 651 476 651 l 658 651 l 658 581 q 587 592 623 587 q 526 597 552 597 q 595 458 595 548 q 516 294 595 356 q 334 232 438 232 q 284 235 312 232 q 250 239 257 239 q 203 220 223 239 q 184 173 184 201 q 216 120 184 136 q 289 104 248 104 l 419 104 q 590 56 523 104 q 658 -93 658 9 q 548 -299 658 -226 q 303 -372 439 -372 q 113 -327 195 -372 q 31 -183 31 -283 q 74 -62 31 -110 q 189 8 118 -13 q 109 51 139 25 q 79 123 79 77 m 325 278 q 430 332 393 278 q 468 457 468 386 q 431 575 468 525 q 330 625 395 625 q 227 570 265 625 q 189 447 189 515 q 224 328 189 379 q 325 278 259 278 m 330 -316 q 481 -270 414 -316 q 548 -141 548 -224 q 490 -29 548 -62 q 346 3 432 3 q 195 -36 258 3 q 133 -162 133 -76 q 191 -277 133 -238 q 330 -316 250 -316 "},"Â²":{"x_min":15,"x_max":403.78125,"ha":485,"o":"m 291 743 q 265 830 291 795 q 193 866 239 866 q 117 836 146 866 q 81 760 88 807 l 74 759 q 53 802 66 779 q 31 836 39 824 q 206 901 106 901 q 327 862 273 901 q 382 757 382 824 q 276 567 382 656 q 108 430 171 478 l 286 430 q 343 430 309 430 q 403 436 376 430 l 398 396 l 403 358 l 297 358 l 108 358 l 15 358 l 15 377 q 216 567 141 484 q 291 743 291 650 "},"Îš":{"x_min":105.84375,"x_max":839.921875,"ha":805,"o":"m 256 314 q 256 132 256 250 q 256 0 256 14 q 224 4 250 0 q 185 9 198 9 q 145 4 171 9 q 114 0 119 0 q 114 240 114 71 q 114 465 114 408 q 114 711 114 621 q 105 932 114 802 q 150 928 122 932 q 184 925 179 925 q 227 928 200 925 q 256 932 254 932 l 256 671 l 256 498 q 473 693 372 586 q 673 932 574 800 q 718 930 697 930 q 762 930 739 930 l 820 930 q 594 727 706 830 q 381 522 483 623 q 515 358 456 426 q 653 203 574 290 q 839 -2 732 115 l 732 -2 q 679 -2 702 -2 q 631 -8 656 -2 q 561 92 599 45 q 470 204 523 140 l 256 458 l 256 314 "},"Ã«":{"x_min":39,"x_max":632,"ha":666,"o":"m 398 42 q 590 129 512 42 l 609 126 q 601 90 605 109 q 597 46 597 71 q 486 0 546 14 q 361 -15 426 -15 q 127 73 215 -15 q 39 311 39 162 q 123 562 39 456 q 347 669 207 669 q 551 590 470 669 q 632 387 632 512 l 632 332 q 429 332 551 332 q 307 332 308 332 l 175 332 q 230 127 175 212 q 398 42 285 42 m 214 929 q 266 906 244 929 q 288 854 288 884 q 267 800 288 822 q 217 778 247 778 q 163 800 186 778 q 140 854 140 822 q 161 906 140 884 q 214 929 183 929 m 451 929 q 503 906 483 929 q 524 854 524 884 q 504 799 524 820 q 453 778 484 778 q 399 800 421 778 q 378 854 378 822 q 399 906 378 884 q 451 929 421 929 m 503 390 l 503 436 q 460 563 503 508 q 349 618 418 618 q 228 552 266 618 q 179 390 191 487 l 503 390 "},"e":{"x_min":41,"x_max":632,"ha":667,"o":"m 399 42 q 591 129 513 42 l 607 125 q 600 85 603 104 q 598 44 598 66 q 489 0 551 14 q 363 -15 426 -15 q 128 73 216 -15 q 41 311 41 161 q 125 563 41 455 q 349 672 210 672 q 552 592 473 672 q 632 385 632 513 l 632 332 l 308 332 l 176 332 q 231 126 176 211 q 399 42 286 42 m 503 390 l 503 434 q 461 563 503 508 q 351 618 420 618 q 228 553 265 618 q 178 390 190 489 l 503 390 "},"ÏŒ":{"x_min":41,"x_max":697,"ha":738,"o":"m 364 -15 q 130 77 219 -15 q 41 321 41 171 q 131 573 41 474 q 371 672 222 672 q 607 574 518 672 q 697 325 697 477 q 606 79 697 174 q 364 -15 515 -15 m 515 942 q 548 973 532 963 q 584 984 563 984 q 620 968 607 984 q 634 931 634 953 q 620 896 634 910 q 579 866 606 882 l 382 743 l 335 743 l 515 942 m 370 619 q 222 530 268 619 q 177 327 177 441 q 223 125 177 216 q 369 34 269 34 q 515 122 470 34 q 560 325 560 210 q 515 529 560 439 q 370 619 471 619 "},"J":{"x_min":-69,"x_max":263.109375,"ha":377,"o":"m 116 -40 q 127 62 127 9 q 127 184 127 115 q 127 461 127 325 q 127 690 127 598 q 109 932 127 781 q 156 928 127 932 q 189 925 185 925 q 233 927 216 925 q 263 932 250 929 q 263 665 263 843 q 263 457 263 487 l 263 165 q 263 107 263 147 q 263 48 263 68 q 172 -155 263 -88 q -60 -222 81 -222 l -69 -180 q 50 -134 1 -166 q 116 -40 98 -102 "},"Â»":{"x_min":42.1875,"x_max":532.1875,"ha":595,"o":"m 191 322 l 42 606 l 80 644 l 296 322 l 80 0 l 42 37 l 191 322 m 427 322 l 277 606 l 315 644 l 532 322 l 315 0 l 277 37 l 427 322 "},"Â©":{"x_min":79,"x_max":1037,"ha":1116,"o":"m 800 904 q 973 725 909 840 q 1037 481 1037 610 q 894 138 1037 282 q 556 -6 751 -6 q 221 139 363 -6 q 79 481 79 284 q 220 825 79 681 q 558 970 362 970 q 800 904 684 970 m 558 917 q 258 787 385 917 q 132 480 132 658 q 257 175 132 306 q 555 45 382 45 q 855 174 726 45 q 984 478 984 304 q 928 698 984 596 q 771 858 872 800 q 558 917 670 917 m 559 723 q 433 651 475 723 q 392 489 392 580 q 430 319 392 395 q 549 244 469 244 q 651 277 609 244 q 709 368 694 310 l 782 368 q 707 231 773 282 q 551 180 641 180 q 373 267 438 180 q 308 475 308 354 q 373 693 308 603 q 560 784 439 784 q 703 737 643 784 q 777 609 763 690 l 700 609 q 651 691 691 659 q 559 723 612 723 "},"ÏŽ":{"x_min":39,"x_max":1008,"ha":1046,"o":"m 523 526 l 582 526 l 582 305 q 603 117 582 193 q 708 42 625 42 q 833 118 795 42 q 871 293 871 194 q 812 502 871 409 q 651 654 753 594 l 703 648 q 788 654 750 648 q 947 510 886 607 q 1008 304 1008 414 q 929 81 1008 178 q 728 -15 850 -15 q 609 16 664 -15 q 523 104 554 47 q 436 16 490 48 q 316 -15 381 -15 q 115 83 192 -15 q 39 311 39 182 q 98 511 39 419 q 256 654 158 604 q 296 650 272 650 q 342 650 320 650 l 393 654 q 233 501 290 592 q 176 291 176 409 q 214 116 176 191 q 340 42 252 42 q 410 68 381 42 q 451 137 438 94 q 462 216 462 175 q 462 302 462 256 q 462 418 462 352 q 462 526 462 484 l 523 526 m 667 943 q 700 974 685 963 q 735 984 715 984 q 772 969 758 984 q 786 931 786 954 q 771 896 786 912 q 731 866 757 880 l 535 743 l 487 743 l 667 943 "},"â‰¥":{"x_min":173,"x_max":943,"ha":1116,"o":"m 943 462 l 173 195 l 173 266 l 832 491 l 173 717 l 173 787 l 943 522 l 943 462 m 943 26 l 173 26 l 173 93 l 943 93 l 943 26 "},"^":{"x_min":0,"x_max":382.46875,"ha":395,"o":"m 147 978 l 234 978 l 382 743 l 337 743 l 191 875 l 47 743 l 0 743 l 147 978 "},"Â«":{"x_min":47.640625,"x_max":539,"ha":595,"o":"m 149 326 l 303 43 l 264 4 l 47 326 l 264 648 l 303 610 l 149 326 m 386 326 l 539 43 l 499 4 l 283 326 l 499 648 l 539 610 l 386 326 "},"D":{"x_min":114,"x_max":971,"ha":1021,"o":"m 114 466 q 114 704 114 537 q 114 933 114 871 l 206 933 q 343 933 246 933 q 467 933 440 933 q 567 933 542 933 q 695 915 593 933 q 884 774 798 898 q 971 484 971 650 q 835 133 971 263 q 481 4 699 4 l 371 4 l 224 4 l 199 4 q 145 3 169 4 q 114 1 120 2 q 114 240 114 72 q 114 466 114 409 m 391 64 q 709 168 595 64 q 823 476 823 272 q 716 770 823 667 q 420 873 609 873 q 338 873 393 873 q 253 873 284 873 l 253 499 l 253 377 l 253 76 q 322 68 283 72 q 391 64 362 64 "},"w":{"x_min":4.078125,"x_max":1031.71875,"ha":1026,"o":"m 4 653 q 54 647 40 647 q 84 647 68 647 q 161 653 118 647 q 186 540 172 587 q 234 394 200 492 l 322 141 q 488 653 411 386 q 540 647 515 647 q 597 653 566 647 q 624 544 608 601 q 664 420 641 487 l 755 136 l 854 413 q 893 532 875 472 q 925 653 911 592 q 960 647 951 647 q 980 647 969 647 q 1031 653 1001 647 q 941 457 982 555 q 854 235 901 359 q 766 0 807 111 q 739 3 756 0 q 718 7 722 7 q 693 3 709 7 q 672 0 677 0 q 636 127 653 72 q 598 238 619 183 l 507 494 q 423 258 465 383 q 341 0 382 134 q 318 3 329 1 q 291 6 307 6 q 264 3 279 6 q 240 0 249 1 q 159 243 196 140 q 84 446 122 347 q 4 653 46 545 "},"$":{"x_min":87,"x_max":652,"ha":734,"o":"m 136 186 l 142 186 q 209 91 162 119 q 335 49 256 63 l 335 416 q 139 515 192 458 q 87 648 87 573 q 160 819 87 752 q 335 886 234 886 q 322 984 335 935 l 351 979 l 393 984 q 393 924 393 945 q 393 886 393 904 q 499 874 447 886 q 593 834 551 862 q 570 787 580 807 q 544 729 561 767 l 536 729 q 485 810 524 783 q 391 837 446 837 l 391 522 q 597 420 543 480 q 652 279 652 361 q 576 89 652 166 q 389 2 500 12 l 389 -30 q 389 -62 389 -47 q 395 -124 389 -77 l 360 -120 l 322 -124 l 335 0 q 206 13 268 0 q 96 58 144 27 l 136 186 m 335 835 q 232 787 272 825 q 192 685 192 748 q 232 588 192 626 q 335 537 273 551 l 335 835 m 542 231 q 503 337 542 299 q 391 402 464 374 l 391 51 q 501 113 461 66 q 542 231 542 159 "},"â€§":{"x_min":132,"x_max":304,"ha":437,"o":"m 219 636 q 279 611 254 636 q 304 548 304 586 q 280 486 304 512 q 219 461 256 461 q 157 486 183 461 q 132 548 132 511 q 157 610 132 584 q 219 636 182 636 "},"\\":{"x_min":-35.390625,"x_max":394.71875,"ha":376,"o":"m -35 1025 l 27 1025 l 394 -126 l 333 -126 l -35 1025 "},"Î™":{"x_min":107.84375,"x_max":260.875,"ha":377,"o":"m 116 465 q 116 711 116 620 q 107 932 116 802 q 153 926 128 926 q 189 926 178 926 q 236 929 208 926 q 260 932 265 932 q 260 788 260 887 q 260 659 260 689 l 260 448 l 260 282 q 260 135 260 238 q 260 0 260 31 q 230 4 257 0 q 189 8 202 8 q 149 5 171 8 q 116 0 128 2 q 116 239 116 70 q 116 465 116 408 "},"ÎŽ":{"x_min":-1.4375,"x_max":1179.875,"ha":1142,"o":"m 736 177 l 736 386 q 634 570 697 458 q 531 750 571 681 q 421 932 491 819 q 473 928 439 932 q 511 925 507 925 q 559 927 538 925 q 593 932 580 930 q 652 800 620 866 q 719 676 684 734 l 831 474 q 948 688 891 574 q 1064 932 1005 801 l 1118 926 q 1149 927 1136 926 q 1179 932 1163 929 q 994 627 1076 769 l 875 415 l 875 240 q 875 102 875 198 q 875 0 875 5 q 842 4 866 1 q 802 7 817 7 q 761 4 776 7 q 727 0 746 2 q 736 88 736 36 q 736 177 736 140 m 178 942 q 210 973 195 963 q 246 984 225 984 q 283 968 268 984 q 298 931 298 953 q 283 896 298 910 q 242 866 269 881 l 46 743 l -1 743 l 178 942 "},"â€™":{"x_min":88.03125,"x_max":299,"ha":366,"o":"m 165 858 q 193 922 173 893 q 244 952 213 952 q 282 938 266 952 q 299 902 299 924 q 288 856 299 881 q 263 810 278 832 l 117 567 l 88 575 l 165 858 "},"Î":{"x_min":96.390625,"x_max":894.046875,"ha":991,"o":"m 110 230 q 110 486 110 315 q 110 741 110 656 l 110 950 l 163 950 q 320 766 235 865 q 459 606 405 667 q 596 451 513 544 l 800 229 l 800 605 q 800 765 800 685 q 786 929 800 845 l 839 929 l 894 929 q 881 831 888 884 q 875 741 875 779 q 875 413 875 619 q 875 165 875 206 l 875 -15 l 832 -15 q 716 125 780 49 q 578 281 651 201 l 189 702 l 189 330 q 208 0 189 169 l 146 0 l 96 0 q 110 124 110 79 q 110 230 110 170 "},"-":{"x_min":57,"x_max":381,"ha":440,"o":"m 57 391 l 381 391 l 381 274 l 57 274 l 57 391 "},"Q":{"x_min":50,"x_max":1052.796875,"ha":1096,"o":"m 554 -15 q 190 112 331 -15 q 50 465 50 240 q 188 820 50 690 q 548 950 326 950 q 874 853 738 950 q 1025 654 1010 756 q 1043 525 1040 551 q 1046 462 1046 499 q 1043 405 1046 429 q 1028 305 1040 381 q 940 144 1017 229 q 732 7 863 59 l 911 -112 q 983 -160 943 -135 q 1052 -199 1024 -185 q 987 -228 1014 -213 q 931 -266 960 -242 q 858 -208 893 -234 q 787 -154 823 -181 l 593 -15 l 554 -15 m 198 468 q 285 163 198 283 q 547 43 372 43 q 809 163 723 43 q 896 468 896 284 q 808 770 896 651 q 547 889 720 889 q 341 826 421 889 q 221 638 261 763 q 198 468 198 552 "},"Ï‚":{"x_min":44,"x_max":601.4375,"ha":631,"o":"m 299 -205 q 344 -218 320 -218 q 439 -177 400 -218 q 478 -79 478 -136 q 369 55 478 4 q 157 156 261 106 q 44 365 44 231 q 141 585 44 499 q 373 672 238 672 q 496 658 439 672 q 601 616 553 645 q 575 501 583 559 l 551 501 q 492 586 539 557 q 384 616 445 616 q 229 551 291 616 q 168 394 168 486 q 213 271 168 320 q 333 197 259 223 l 458 149 q 558 76 521 119 q 596 -27 596 34 q 512 -206 596 -136 q 316 -292 428 -276 l 299 -205 "},"M":{"x_min":54.65625,"x_max":1142.328125,"ha":1213,"o":"m 187 950 l 238 950 q 325 772 286 851 q 404 612 363 693 q 494 436 445 531 l 614 213 q 728 435 659 298 q 866 711 798 572 q 981 950 934 849 l 1032 950 q 1062 649 1047 791 q 1097 341 1077 508 q 1142 0 1117 174 q 1100 8 1117 5 q 1067 11 1082 11 q 1029 6 1051 11 q 979 0 1007 2 q 979 226 979 109 q 961 461 979 342 q 925 695 943 579 l 734 312 q 599 0 652 152 l 583 0 l 565 0 q 223 684 395 363 l 185 306 q 169 128 169 179 q 169 0 169 77 q 136 4 155 1 q 109 7 117 7 q 80 4 92 7 q 54 0 68 2 q 119 333 88 167 q 168 652 150 498 q 187 950 187 805 "},"Î¨":{"x_min":72,"x_max":977,"ha":1049,"o":"m 592 0 q 551 5 575 2 q 523 8 527 8 q 486 5 507 8 q 455 0 466 2 q 455 151 455 45 q 455 297 455 258 q 177 382 283 297 q 72 649 72 468 l 72 815 l 72 931 q 138 924 110 924 q 179 927 153 924 q 209 931 204 931 q 199 817 199 860 q 199 722 199 774 l 199 688 l 199 638 q 266 437 199 507 q 457 368 333 368 l 457 481 q 457 735 457 566 q 457 931 457 904 q 491 926 473 928 q 523 924 509 924 q 566 926 547 924 q 590 931 585 929 q 590 634 590 840 q 590 369 590 428 l 634 369 q 798 463 751 369 q 845 690 845 557 q 845 828 845 739 q 845 931 845 918 q 879 926 862 928 q 907 924 896 924 q 953 926 937 924 q 977 931 968 929 l 977 837 l 977 674 q 879 388 977 480 q 592 297 782 297 q 592 142 592 249 q 592 0 592 35 "},"C":{"x_min":50,"x_max":863.859375,"ha":894,"o":"m 812 738 q 541 889 719 889 q 288 768 375 889 q 202 469 202 647 q 292 177 202 305 q 539 50 383 50 q 695 86 624 50 q 838 188 767 122 l 852 183 q 841 122 844 147 q 838 69 838 97 q 511 -15 685 -15 q 176 116 303 -15 q 50 462 50 248 q 185 820 50 690 q 545 950 320 950 q 704 930 625 950 q 863 875 783 911 q 840 809 850 843 q 830 738 830 775 l 812 738 "},"Å“":{"x_min":38,"x_max":1171,"ha":1202,"o":"m 352 -14 q 123 76 208 -14 q 38 317 38 167 q 123 569 38 469 q 355 669 208 669 q 504 637 432 669 q 628 548 576 605 q 878 672 726 672 q 1087 593 1003 672 q 1171 388 1171 514 l 1171 332 q 1001 332 1086 332 q 834 332 917 332 l 694 332 q 749 124 694 207 q 925 42 805 42 q 1123 129 1046 42 l 1139 126 q 1132 82 1135 107 q 1128 46 1130 58 q 1016 0 1078 14 q 886 -15 954 -15 q 739 12 803 -15 q 628 105 674 40 q 504 15 572 44 q 352 -14 435 -14 m 368 622 q 219 531 264 622 q 175 327 175 441 q 219 125 175 215 q 361 35 263 35 q 511 127 461 35 q 562 327 562 220 q 516 531 562 441 q 368 622 470 622 m 1040 390 l 1040 422 q 997 560 1040 503 q 876 618 954 618 q 741 549 789 618 q 694 390 694 480 l 1040 390 "},"!":{"x_min":133,"x_max":306,"ha":439,"o":"m 218 156 q 280 130 254 156 q 306 68 306 105 q 280 8 306 32 q 218 -15 254 -15 q 158 9 183 -15 q 133 68 133 33 q 157 130 133 105 q 218 156 182 156 m 144 752 l 144 841 q 160 919 144 888 q 220 950 177 950 q 277 925 256 950 q 298 863 298 901 q 293 808 298 845 q 289 752 289 770 l 242 250 q 218 253 233 253 q 195 250 202 253 l 144 752 "},"Ã§":{"x_min":34,"x_max":603.296875,"ha":632,"o":"m 596 119 l 581 42 q 481 -2 539 10 q 356 -15 423 -15 q 128 80 223 -15 q 34 313 34 175 q 130 576 34 480 q 390 672 227 672 q 501 659 448 672 q 603 617 555 647 q 586 558 593 587 q 573 493 578 529 l 559 493 q 498 588 537 554 q 399 622 458 622 q 230 534 288 622 q 173 329 173 447 q 234 126 173 211 q 407 42 295 42 q 581 123 512 42 l 596 119 m 198 -212 q 344 -246 268 -246 q 406 -232 381 -246 q 432 -187 432 -219 q 413 -143 432 -159 q 366 -128 395 -128 l 317 -128 l 317 0 l 361 0 l 361 -75 l 397 -75 q 486 -104 449 -75 q 523 -184 523 -134 q 485 -270 523 -238 q 394 -303 448 -303 q 281 -294 329 -303 q 181 -261 234 -286 l 198 -212 "},"{":{"x_min":114,"x_max":556,"ha":669,"o":"m 481 911 q 412 875 436 911 q 389 793 389 840 l 389 744 l 389 583 q 360 434 389 493 q 258 354 332 376 q 360 272 331 332 q 389 125 389 212 l 389 -35 q 405 -149 389 -108 q 462 -197 422 -191 q 519 -204 501 -204 q 556 -204 536 -204 l 556 -276 q 378 -240 449 -276 q 307 -105 307 -204 l 307 -29 l 307 132 q 288 245 307 194 q 234 304 270 295 q 172 314 199 314 q 114 314 145 314 l 114 389 q 263 429 220 389 q 307 576 307 469 l 307 737 q 339 918 307 870 q 440 977 372 966 q 556 983 493 983 l 556 911 l 481 911 "},"X":{"x_min":0,"x_max":724.109375,"ha":724,"o":"m 196 286 l 311 456 q 17 932 156 717 q 62 929 32 932 q 107 926 92 926 q 164 929 144 926 q 194 932 185 932 q 290 742 239 841 q 383 567 341 644 l 479 726 q 585 932 537 824 q 615 927 601 929 q 647 926 628 926 q 679 929 657 926 q 713 932 700 932 q 603 780 660 862 q 514 652 547 699 l 419 512 q 513 347 470 419 q 602 197 555 274 q 724 0 649 119 q 672 3 705 0 q 634 7 639 7 q 583 4 605 7 q 547 0 560 1 q 449 197 502 97 q 345 398 397 298 l 259 249 q 170 96 189 130 q 125 0 152 62 q 87 3 111 0 q 61 7 63 7 q 25 4 42 7 q 0 0 9 1 l 196 286 "},"Ã´":{"x_min":39,"x_max":698,"ha":737,"o":"m 364 -15 q 128 79 218 -15 q 39 322 39 173 q 130 572 39 473 q 372 672 222 672 q 608 575 519 672 q 698 327 698 479 q 607 80 698 175 q 364 -15 516 -15 m 324 977 l 411 977 l 560 743 l 514 743 l 368 874 l 223 743 l 176 743 l 324 977 m 369 622 q 222 532 268 622 q 176 327 176 442 q 222 125 176 216 q 368 34 268 34 q 514 124 469 34 q 559 327 559 214 q 514 531 559 441 q 369 622 470 622 "},"#":{"x_min":76.21875,"x_max":952.78125,"ha":1029,"o":"m 488 647 l 661 647 l 774 969 l 858 969 l 745 647 l 952 647 l 929 576 l 721 576 l 658 391 l 877 391 l 856 319 l 631 319 l 519 0 l 436 0 l 548 319 l 374 319 l 261 0 l 178 0 l 288 319 l 76 319 l 100 391 l 314 391 l 378 576 l 148 576 l 172 647 l 402 647 l 515 969 l 598 969 l 488 647 m 462 576 l 398 390 l 574 390 l 637 576 l 462 576 "},"Î¹":{"x_min":93.921875,"x_max":228.453125,"ha":335,"o":"m 98 333 l 98 520 q 98 566 98 544 q 93 653 98 588 q 138 647 127 647 q 161 647 148 647 q 228 653 191 647 q 223 555 223 599 q 223 437 223 511 l 223 406 q 223 194 223 337 q 223 0 223 51 q 197 3 212 1 q 161 6 182 6 q 125 3 145 6 q 98 0 104 1 q 98 165 98 51 q 98 333 98 279 "},"Î†":{"x_min":12.5625,"x_max":893.203125,"ha":878,"o":"m 322 638 l 450 949 q 480 944 456 946 q 513 949 498 944 q 643 613 591 745 q 756 331 695 480 q 893 0 816 181 q 842 3 874 0 q 807 7 811 7 q 757 4 780 7 q 721 0 735 1 q 659 195 679 135 q 601 355 640 255 l 441 355 l 280 355 l 228 205 q 170 0 190 94 l 114 6 q 75 3 90 6 q 54 0 61 0 q 144 211 99 105 q 225 403 189 317 q 322 638 261 490 m 192 942 q 224 973 209 963 q 260 984 239 984 q 297 968 282 984 q 312 931 312 953 q 297 896 312 910 q 256 866 283 881 l 60 743 l 12 743 l 192 942 m 441 422 l 573 422 l 442 761 l 312 422 l 441 422 "},")":{"x_min":65.65625,"x_max":327,"ha":440,"o":"m 327 376 q 267 81 327 217 q 95 -183 208 -54 q 65 -151 83 -163 q 191 104 154 -16 q 229 385 229 226 q 188 660 229 533 q 65 917 148 788 q 95 949 87 933 q 269 681 212 816 q 327 376 327 545 "},"Îµ":{"x_min":52,"x_max":557.359375,"ha":616,"o":"m 497 516 q 425 591 459 566 q 346 616 392 616 q 257 580 293 616 q 221 493 221 545 q 263 407 221 438 q 365 376 305 376 l 409 376 l 409 351 l 409 314 l 338 314 q 232 279 275 314 q 189 181 189 245 q 234 76 189 115 q 345 37 279 37 q 452 65 403 37 q 534 144 501 94 q 543 98 538 121 q 557 53 549 75 q 444 1 506 18 q 316 -16 381 -16 q 132 30 212 -16 q 52 174 52 77 q 93 286 52 245 q 209 355 135 326 q 125 408 159 370 q 92 496 92 445 q 162 625 92 578 q 317 672 233 672 q 422 654 372 672 q 531 604 473 637 q 513 564 520 584 q 497 516 505 545 "},"Î”":{"x_min":0,"x_max":880.640625,"ha":881,"o":"m 880 6 q 687 6 816 6 q 491 6 558 6 q 246 6 409 6 q 0 6 83 6 q 220 473 123 251 q 398 932 317 695 q 423 929 406 932 q 447 926 439 926 q 472 927 461 926 q 495 932 483 929 q 677 451 589 663 q 880 6 766 238 m 276 426 q 155 85 208 255 q 284 85 197 85 q 415 85 371 85 l 447 85 q 575 85 539 85 q 677 90 612 85 l 638 189 l 564 383 l 413 777 l 276 426 "},"Ã¢":{"x_min":42,"x_max":642,"ha":635,"o":"m 229 -16 q 96 32 150 -16 q 42 161 42 81 q 104 302 42 272 q 297 363 166 332 q 435 447 428 395 q 395 568 435 521 q 283 616 355 616 q 187 587 228 616 q 122 507 147 559 l 93 520 l 102 590 q 198 651 141 631 q 317 672 255 672 q 490 622 435 672 q 546 454 546 572 l 546 132 q 556 68 546 83 q 605 54 566 54 q 642 57 629 54 l 642 26 q 582 5 613 14 q 526 -6 551 -3 q 430 83 445 -6 q 336 9 381 34 q 229 -16 291 -16 m 273 977 l 360 977 l 511 742 l 461 742 l 317 874 l 173 742 l 123 742 l 273 977 m 173 185 q 200 97 173 132 q 279 63 228 63 q 383 106 336 63 q 430 211 430 150 l 430 345 q 235 292 298 318 q 173 185 173 267 "},"}":{"x_min":112,"x_max":556,"ha":670,"o":"m 363 576 q 398 438 363 487 q 517 389 433 389 l 556 389 l 556 317 q 407 278 452 317 q 363 132 363 239 l 363 -28 q 314 -229 363 -183 q 112 -276 266 -276 l 112 -204 q 247 -172 214 -204 q 281 -83 281 -141 l 281 -35 l 281 125 q 309 271 281 212 q 410 354 337 329 q 306 434 331 382 q 281 583 281 487 l 281 744 q 263 858 281 816 q 188 911 246 901 l 112 911 l 112 982 l 182 982 q 282 960 238 982 q 341 900 326 938 q 359 822 356 862 q 363 737 363 783 l 363 576 "},"â€°":{"x_min":27,"x_max":1481,"ha":1506,"o":"m 783 0 q 633 62 693 0 q 574 218 574 124 q 634 372 574 309 q 783 436 695 436 q 931 373 871 436 q 991 223 991 310 q 976 130 991 176 q 900 35 952 70 q 783 0 847 0 m 1272 0 q 1124 62 1183 0 q 1066 218 1066 124 q 1125 372 1066 308 q 1274 436 1185 436 q 1421 373 1361 436 q 1481 223 1481 310 q 1464 130 1481 169 q 1390 34 1442 69 q 1272 0 1338 0 m 236 448 q 86 510 146 448 q 27 663 27 572 q 87 819 27 754 q 236 884 148 884 q 383 822 322 884 q 444 671 444 760 q 426 580 444 620 q 352 483 404 519 q 236 448 300 448 m 845 1014 l 222 -126 l 154 -126 l 777 1014 l 845 1014 m 878 260 q 853 353 878 310 q 782 397 829 397 q 704 340 722 397 q 686 202 686 283 q 705 86 686 133 q 782 40 724 40 q 848 73 823 40 q 874 149 874 106 q 878 206 878 169 q 878 260 878 242 m 332 684 q 312 796 332 749 q 239 844 293 844 q 157 783 177 844 q 137 645 137 723 q 160 539 137 589 q 232 490 184 490 q 297 524 272 490 q 327 598 322 558 q 332 684 332 638 m 1368 260 q 1345 356 1368 315 q 1270 397 1322 397 q 1194 340 1212 397 q 1176 202 1176 283 q 1195 87 1176 134 q 1271 40 1214 40 q 1338 73 1313 40 q 1364 149 1364 106 q 1368 206 1368 169 q 1368 260 1368 242 "},"Ã„":{"x_min":-16.65625,"x_max":821.9375,"ha":810,"o":"m 252 638 l 381 951 q 410 945 386 948 q 443 951 428 945 q 558 651 489 826 q 674 360 627 477 q 821 0 721 242 q 771 3 802 0 q 736 7 740 7 q 687 3 713 7 q 651 0 661 0 q 587 203 602 156 q 530 355 571 250 l 369 355 l 209 355 l 157 205 q 126 108 143 169 q 99 0 109 47 l 43 4 q 18 4 28 4 q -16 0 9 4 q 70 203 28 105 q 165 426 112 300 q 252 638 217 552 m 287 1208 q 338 1186 318 1208 q 358 1133 358 1164 q 337 1080 358 1102 q 287 1058 317 1058 q 233 1080 255 1058 q 212 1133 212 1102 q 233 1185 212 1163 q 287 1208 255 1208 m 523 1208 q 574 1186 553 1208 q 596 1133 596 1164 q 574 1080 596 1103 q 523 1058 553 1058 q 470 1080 492 1058 q 449 1133 449 1102 q 470 1185 449 1163 q 523 1208 492 1208 m 370 422 l 503 422 l 372 762 l 240 422 l 370 422 "},"a":{"x_min":44,"x_max":642,"ha":635,"o":"m 230 -15 q 98 33 152 -15 q 44 162 44 82 q 104 302 44 273 q 297 363 165 332 q 435 448 429 395 q 394 567 435 519 q 282 615 352 615 q 187 587 227 615 q 122 508 147 560 l 94 519 l 102 591 q 201 651 146 631 q 317 672 256 672 q 490 623 436 672 q 545 456 545 574 l 545 132 q 556 70 545 86 q 605 54 568 54 l 642 54 l 642 26 q 583 4 613 15 q 527 -7 554 -7 q 461 15 483 -7 q 429 83 438 38 q 335 9 381 34 q 230 -15 290 -15 m 172 185 q 201 99 172 135 q 278 63 230 63 q 383 106 337 63 q 429 211 429 150 l 429 344 q 235 294 299 320 q 172 185 172 268 "},"â€”":{"x_min":222,"x_max":1116,"ha":1339,"o":"m 222 375 l 1116 375 l 1116 292 l 222 292 l 222 375 "},"=":{"x_min":166,"x_max":950,"ha":1116,"o":"m 950 499 l 166 499 l 166 564 l 950 564 l 950 499 m 950 249 l 166 249 l 166 316 l 950 316 l 950 249 "},"N":{"x_min":96.390625,"x_max":894.046875,"ha":991,"o":"m 110 230 q 110 486 110 315 q 110 741 110 656 l 110 950 l 163 950 q 320 766 235 865 q 459 606 405 667 q 596 451 513 544 l 800 229 l 800 605 q 800 765 800 685 q 786 929 800 845 l 839 929 l 894 929 q 881 831 888 884 q 875 741 875 779 q 875 413 875 619 q 875 165 875 206 l 875 -15 l 832 -15 q 716 125 780 49 q 578 281 651 201 l 189 702 l 189 330 q 208 0 189 169 l 146 0 l 96 0 q 110 124 110 79 q 110 230 110 170 "},"Ï":{"x_min":69,"x_max":696,"ha":742,"o":"m 192 -100 q 192 -236 192 -146 q 192 -372 192 -326 q 159 -367 167 -368 q 131 -367 151 -367 q 94 -369 114 -367 q 69 -372 74 -371 q 69 -190 69 -311 q 69 -8 69 -70 q 69 166 69 67 q 69 328 69 264 q 145 578 69 484 q 372 672 221 672 q 604 573 513 672 q 696 328 696 474 q 613 84 696 184 q 391 -16 530 -16 q 283 6 330 -16 q 192 77 236 29 l 192 -100 m 370 619 q 227 532 266 619 q 187 327 187 446 q 237 102 187 168 q 368 37 287 37 q 514 124 469 37 q 559 325 559 212 q 514 529 559 439 q 370 619 470 619 "},"2":{"x_min":22,"x_max":610.453125,"ha":734,"o":"m 440 648 q 401 789 440 727 q 293 851 363 851 q 170 802 215 851 q 126 676 126 753 l 116 673 q 83 739 98 712 q 46 799 68 767 q 307 911 155 911 q 497 844 417 911 q 577 667 577 777 q 517 479 577 555 q 309 258 457 403 l 166 118 l 434 118 q 520 123 476 118 q 610 136 564 129 q 606 102 607 118 q 605 67 605 87 q 606 37 605 54 q 610 4 607 20 q 430 4 551 4 q 248 4 309 4 q 140 4 192 4 q 22 0 87 4 l 22 40 q 229 238 153 158 q 373 430 306 319 q 440 648 440 541 "},"Ã¼":{"x_min":91,"x_max":650.53125,"ha":739,"o":"m 641 498 q 641 329 641 443 q 641 158 641 215 q 650 0 641 81 q 619 3 634 1 q 586 6 604 6 q 552 3 571 6 q 523 0 533 1 l 523 118 q 430 18 484 52 q 304 -15 376 -15 q 143 50 195 -15 q 91 229 91 115 l 91 354 l 91 516 l 91 655 q 117 650 101 651 q 155 650 133 650 q 188 650 171 650 q 215 655 205 650 q 215 445 215 591 q 215 247 215 299 q 247 115 215 163 q 356 68 279 68 q 463 113 418 68 q 515 217 509 159 q 521 340 521 274 q 521 520 521 394 q 521 655 521 647 q 547 650 532 651 q 585 650 563 650 q 617 650 600 650 q 650 655 634 650 q 641 498 641 573 m 249 929 q 302 906 280 929 q 324 854 324 884 q 303 800 324 822 q 253 778 283 778 q 199 800 221 778 q 177 854 177 823 q 197 906 177 884 q 249 929 217 929 m 488 929 q 539 906 517 929 q 561 854 561 884 q 541 799 561 820 q 490 778 521 778 q 435 800 457 778 q 414 854 414 822 q 435 906 414 884 q 488 929 457 929 "},"Z":{"x_min":7,"x_max":786,"ha":812,"o":"m 7 36 q 218 325 110 176 q 416 605 326 473 l 585 857 l 424 857 q 58 836 242 857 l 64 883 l 58 926 q 257 926 132 926 q 419 926 382 926 q 610 926 481 926 q 786 926 739 926 l 786 903 q 582 630 695 786 q 391 364 469 475 q 197 82 313 253 l 419 82 q 570 82 510 82 q 786 102 630 82 l 781 68 l 780 54 l 780 34 l 786 4 q 494 4 669 4 q 318 4 320 4 q 163 4 266 4 q 7 4 60 4 l 7 36 "},"u":{"x_min":91,"x_max":649.4375,"ha":739,"o":"m 644 497 l 644 157 q 644 83 644 122 q 649 -1 644 45 q 612 3 620 3 q 585 3 604 3 q 561 3 570 3 q 523 -1 552 3 l 523 117 q 430 18 482 52 q 306 -15 378 -15 q 142 49 193 -15 q 91 228 91 113 l 91 353 l 91 516 l 91 653 q 155 647 122 647 q 185 648 174 647 q 215 653 195 649 q 215 450 215 585 q 215 246 215 314 q 247 114 215 163 q 356 66 279 66 q 464 112 419 66 q 516 225 510 158 q 521 340 521 282 q 521 497 521 393 q 521 653 521 601 q 561 647 552 647 q 583 647 570 647 q 614 648 604 647 q 644 653 624 649 l 644 497 "},"k":{"x_min":98,"x_max":664,"ha":669,"o":"m 98 656 q 98 873 98 741 q 98 1024 98 1005 q 161 1018 131 1018 q 223 1024 193 1018 q 223 824 223 962 q 223 622 223 687 l 223 378 l 240 378 q 497 653 383 506 q 552 647 527 647 q 604 647 578 647 q 635 652 625 651 l 342 398 l 537 165 q 595 93 566 127 q 664 19 625 59 l 664 0 q 615 3 646 0 q 579 7 585 7 q 533 3 556 7 q 500 0 510 0 q 429 101 463 54 q 353 197 394 148 l 263 308 l 247 323 l 223 326 q 223 164 223 272 q 223 0 223 55 q 197 4 212 3 q 161 6 182 6 q 125 3 144 6 q 98 0 106 1 q 98 386 98 151 q 98 656 98 620 "},"Î—":{"x_min":114,"x_max":910.515625,"ha":1018,"o":"m 257 317 q 257 141 257 253 q 257 0 257 30 q 222 4 248 0 q 184 8 197 8 q 145 4 171 8 q 114 0 119 0 q 114 243 114 71 q 114 464 114 414 q 114 709 114 539 q 114 932 114 880 q 150 929 119 932 q 184 926 180 926 q 227 929 197 926 q 257 932 258 932 q 257 719 257 853 q 257 544 257 584 q 399 544 296 544 q 507 544 502 544 q 653 544 552 544 q 758 544 755 544 q 758 785 758 641 q 758 932 758 930 q 797 929 766 932 q 832 926 828 926 q 875 929 845 926 q 910 932 906 932 q 901 794 901 866 q 901 659 901 723 l 901 505 q 901 252 901 420 q 901 0 901 84 q 871 4 896 0 q 832 8 845 8 q 796 5 813 8 q 758 0 778 2 q 758 103 758 41 q 758 175 758 166 l 758 317 l 758 466 q 591 466 676 466 q 424 466 507 466 l 257 466 l 257 317 "},"Î‘":{"x_min":-14.96875,"x_max":822.109375,"ha":809,"o":"m 253 638 l 379 949 q 394 945 387 946 q 409 944 401 944 q 443 949 428 944 q 565 629 525 733 q 673 359 605 526 q 822 0 740 192 q 773 3 804 0 q 736 7 743 7 q 686 4 709 7 q 650 0 664 1 q 588 199 609 137 q 532 355 567 261 l 370 355 l 210 355 l 159 205 q 127 110 142 161 q 99 0 112 59 l 43 6 q 6 3 20 6 q -14 0 -8 0 q 74 211 29 105 q 155 403 119 317 q 253 638 191 490 m 370 422 l 502 422 l 371 760 l 240 422 l 370 422 "},"ÃŸ":{"x_min":98,"x_max":712,"ha":750,"o":"m 98 432 l 98 611 l 98 761 q 191 948 109 872 q 384 1025 273 1025 q 531 979 467 1025 q 596 852 596 933 q 520 709 596 783 q 444 586 444 636 q 578 457 444 547 q 712 259 712 368 q 635 64 712 143 q 445 -15 559 -15 q 372 -6 411 -15 q 303 15 333 1 l 327 128 l 341 128 q 398 70 361 91 q 476 49 434 49 q 571 92 533 49 q 610 193 610 135 q 475 365 610 280 q 340 525 340 450 q 425 667 340 561 q 510 838 510 773 q 474 939 510 899 q 380 979 438 979 q 267 924 309 979 q 225 795 225 870 l 225 629 l 225 344 q 225 141 225 265 q 225 2 225 17 q 192 5 215 2 q 163 8 170 8 q 121 5 140 8 q 98 2 103 3 q 98 250 98 92 q 98 432 98 409 "},"Ã©":{"x_min":39,"x_max":632,"ha":666,"o":"m 398 42 q 590 129 512 42 l 609 126 q 601 90 605 109 q 597 46 597 71 q 486 0 546 14 q 361 -15 426 -15 q 127 73 215 -15 q 39 311 39 162 q 123 562 39 456 q 347 669 207 669 q 551 590 470 669 q 632 387 632 512 l 632 332 q 429 332 550 332 q 307 332 308 332 l 175 332 q 230 127 175 212 q 398 42 285 42 m 398 945 q 430 975 415 966 q 467 985 445 985 q 518 934 518 985 q 503 895 518 912 q 462 866 488 878 l 266 743 l 217 743 l 398 945 m 503 390 l 503 436 q 460 563 503 508 q 349 618 418 618 q 228 552 266 618 q 179 390 191 487 l 503 390 "},"s":{"x_min":67.109375,"x_max":520,"ha":581,"o":"m 114 161 q 168 69 128 102 q 270 36 209 36 q 370 67 326 36 q 415 152 415 98 q 327 260 415 224 q 164 320 246 290 q 78 460 78 366 q 145 612 78 552 q 303 672 212 672 q 392 660 348 672 q 490 627 436 649 l 451 508 l 439 508 q 393 587 424 561 q 307 614 361 614 q 219 584 257 614 q 181 505 181 555 q 350 374 181 427 q 520 197 520 322 q 441 39 520 93 q 254 -15 362 -15 q 67 23 159 -15 l 101 161 l 114 161 "},"B":{"x_min":110.5625,"x_max":737,"ha":786,"o":"m 116 560 q 110 932 116 759 l 203 932 q 334 932 242 932 q 432 932 426 932 q 618 880 540 932 q 696 724 696 829 q 626 578 696 632 q 456 503 557 524 q 660 438 584 489 q 737 269 737 387 q 628 69 737 135 q 376 3 519 3 l 229 3 q 160 3 208 3 q 116 3 111 3 q 116 289 116 88 q 116 560 116 489 m 255 255 l 255 146 l 255 59 l 330 59 q 516 109 441 59 q 591 266 591 160 q 514 427 591 385 q 310 469 438 469 l 255 469 l 255 255 m 559 705 q 499 831 559 786 q 355 876 439 876 l 257 876 q 248 710 248 799 l 248 522 q 468 558 377 522 q 559 705 559 595 "},"â€¦":{"x_min":117,"x_max":985,"ha":1136,"o":"m 187 131 q 239 109 218 131 q 261 55 261 87 q 239 5 261 25 q 187 -15 218 -15 q 137 4 157 -15 q 117 55 117 23 q 136 109 117 87 q 187 131 156 131 m 550 131 q 600 109 579 131 q 622 55 622 87 q 600 5 622 25 q 550 -15 579 -15 q 498 4 518 -15 q 478 55 478 23 q 498 110 478 89 q 550 131 518 131 m 911 131 q 963 109 942 131 q 985 55 985 87 q 963 5 985 25 q 911 -15 942 -15 q 861 4 881 -15 q 841 55 841 23 q 860 109 841 87 q 911 131 880 131 "},"?":{"x_min":125.53125,"x_max":510,"ha":590,"o":"m 300 155 q 359 129 334 155 q 384 67 384 104 q 360 6 384 29 q 300 -16 336 -16 q 239 7 264 -16 q 215 67 215 31 q 239 129 215 104 q 300 155 264 155 m 322 250 q 210 290 256 250 q 165 399 165 331 q 281 595 165 479 q 398 776 398 712 q 364 858 398 823 q 286 894 331 894 q 203 866 238 894 q 159 794 167 839 l 147 794 q 139 835 143 821 q 125 894 136 849 q 206 936 162 922 q 300 950 250 950 q 448 893 387 950 q 510 748 510 837 q 390 549 510 656 q 271 370 271 443 q 288 316 271 337 q 336 296 305 296 q 389 302 364 296 l 375 256 q 349 251 358 252 q 322 250 341 250 "},"H":{"x_min":105.84375,"x_max":909.515625,"ha":1016,"o":"m 257 316 q 257 142 257 254 q 257 0 257 31 q 224 4 250 0 q 184 9 198 9 q 145 4 171 9 q 114 0 119 0 q 114 239 114 71 q 114 464 114 407 q 114 711 114 620 q 105 932 114 802 q 150 928 122 932 q 184 925 179 925 q 227 928 199 925 q 257 932 254 932 q 257 719 257 854 q 257 544 257 584 l 507 544 l 758 544 q 758 785 758 641 q 758 932 758 930 q 798 928 770 932 q 831 925 826 925 q 876 928 848 925 q 909 932 905 932 q 900 798 900 867 q 900 659 900 728 l 900 448 l 900 283 q 900 135 900 238 q 900 0 900 32 q 871 4 897 0 q 831 9 845 9 q 792 4 818 9 q 758 0 766 0 q 758 101 758 38 q 758 176 758 164 l 758 316 l 758 466 q 591 466 703 466 q 424 466 480 466 l 257 466 l 257 316 "},"Î½":{"x_min":0.359375,"x_max":620,"ha":642,"o":"m 313 8 q 290 5 303 8 q 267 0 278 2 q 196 205 230 120 q 0 653 162 291 q 83 647 45 647 q 111 647 97 647 q 165 653 125 647 q 248 402 200 528 l 352 131 q 460 358 431 267 q 489 520 489 448 q 482 578 489 542 q 468 641 476 615 q 541 649 517 645 q 602 660 565 652 q 616 610 613 623 q 620 576 620 598 q 609 501 620 535 q 549 373 599 466 q 452 189 499 280 q 365 0 404 99 q 339 4 356 0 q 313 8 321 8 "},"Ã®":{"x_min":-24.5,"x_max":358.390625,"ha":334,"o":"m 98 144 l 98 522 l 98 655 q 134 650 110 650 q 163 650 159 650 q 229 655 203 650 q 225 507 225 581 q 225 254 225 423 q 225 0 225 85 q 197 3 212 1 q 160 6 182 6 q 123 3 143 6 q 98 0 104 1 l 98 144 m 122 977 l 209 977 l 358 743 l 313 743 l 167 874 l 23 743 l -24 743 l 122 977 "},"c":{"x_min":35,"x_max":600.75,"ha":631,"o":"m 593 118 l 581 41 q 483 -4 536 6 q 357 -16 429 -16 q 128 78 222 -16 q 35 312 35 173 q 131 576 35 480 q 391 672 228 672 q 502 658 449 672 q 600 616 554 645 q 573 493 584 563 l 558 493 q 499 586 538 553 q 397 619 460 619 q 229 532 287 619 q 172 327 172 445 q 232 125 172 209 q 406 41 293 41 q 581 121 509 41 l 593 118 "},"Â¶":{"x_min":17.40625,"x_max":521,"ha":578,"o":"m 292 967 l 521 967 l 521 909 l 464 909 l 464 3 l 407 3 l 407 909 l 299 909 l 299 3 l 242 3 l 242 557 q 97 601 160 557 q 26 689 35 645 q 17 743 17 733 q 88 895 17 824 q 292 967 160 967 "},"Î²":{"x_min":98,"x_max":723,"ha":764,"o":"m 157 -364 q 126 -367 148 -364 q 98 -369 104 -369 q 98 -254 98 -326 q 98 -170 98 -183 l 98 100 l 98 564 q 161 897 98 770 q 410 1025 225 1025 q 593 960 514 1025 q 673 787 673 895 q 629 641 673 705 q 511 548 585 577 q 668 454 614 515 q 723 290 723 394 q 635 73 723 162 q 423 -15 548 -15 q 317 3 364 -15 q 222 61 270 22 q 222 -44 222 20 q 222 -110 222 -108 l 222 -369 q 187 -367 212 -369 q 157 -364 162 -364 m 348 564 q 497 618 449 564 q 546 779 546 673 q 509 917 546 859 q 397 975 472 975 q 270 906 314 975 q 226 752 226 838 q 226 613 226 701 q 226 506 226 525 l 226 355 l 226 230 q 270 94 226 147 q 398 41 315 41 q 541 116 494 41 q 588 297 588 192 q 538 443 588 386 q 404 500 489 500 q 353 497 376 500 q 321 493 330 494 l 321 516 l 321 564 l 348 564 "},"Îœ":{"x_min":54.65625,"x_max":1142.328125,"ha":1213,"o":"m 187 950 l 238 950 q 325 772 286 851 q 404 612 363 693 q 494 436 445 531 l 614 213 q 728 435 659 298 q 866 711 798 572 q 981 950 934 849 l 1032 950 q 1062 649 1047 791 q 1097 341 1077 508 q 1142 0 1117 174 q 1100 8 1117 5 q 1067 11 1082 11 q 1029 6 1051 11 q 979 0 1007 2 q 979 226 979 109 q 961 461 979 342 q 925 695 943 579 l 734 312 q 599 0 652 152 l 583 0 l 565 0 q 223 684 395 363 l 185 306 q 169 128 169 179 q 169 0 169 77 q 136 4 155 1 q 109 7 117 7 q 80 4 92 7 q 54 0 68 2 q 119 333 88 167 q 168 652 150 498 q 187 950 187 805 "},"ÎŒ":{"x_min":-1.109375,"x_max":1278,"ha":1328,"o":"m 282 465 q 420 820 282 690 q 780 950 558 950 q 1106 853 970 950 q 1257 654 1242 757 q 1275 525 1272 551 q 1278 462 1278 500 q 1275 402 1278 426 q 1257 277 1272 379 q 1107 80 1242 175 q 781 -15 973 -15 q 670 -10 718 -15 q 530 29 622 -5 q 360 186 438 64 q 282 465 282 308 m 178 943 q 211 974 196 964 q 246 985 226 985 q 283 969 268 985 q 298 932 298 954 q 283 896 298 911 q 242 866 269 882 l 46 743 l -1 743 l 178 943 m 430 468 q 517 162 430 282 q 779 42 604 42 q 1041 162 955 42 q 1128 468 1128 283 q 1040 770 1128 651 q 779 889 952 889 q 573 826 653 889 q 453 638 493 763 q 430 468 430 552 "},"Î‰":{"x_min":-1.4375,"x_max":1209.53125,"ha":1316,"o":"m 557 316 q 557 142 557 254 q 557 0 557 31 q 524 4 550 0 q 484 9 498 9 q 445 4 471 9 q 414 0 419 0 q 414 239 414 71 q 414 464 414 407 q 414 711 414 620 q 405 932 414 802 q 450 928 422 932 q 484 925 479 925 q 527 928 499 925 q 557 932 554 932 q 557 719 557 854 q 557 544 557 584 l 807 544 l 1058 544 q 1058 786 1058 641 q 1058 932 1058 930 q 1098 928 1070 932 q 1131 925 1126 925 q 1176 928 1148 925 q 1209 932 1205 932 q 1200 798 1200 868 q 1200 659 1200 729 l 1200 448 l 1200 283 q 1200 135 1200 238 q 1200 0 1200 32 q 1171 4 1197 0 q 1131 9 1145 9 q 1092 4 1118 9 q 1058 0 1066 0 q 1058 101 1058 38 q 1058 176 1058 164 l 1058 316 l 1058 466 q 891 466 1003 466 q 724 466 780 466 l 557 466 l 557 316 m 178 942 q 210 973 195 963 q 246 984 225 984 q 283 968 268 984 q 298 931 298 953 q 283 896 298 910 q 242 866 269 881 l 46 743 l -1 743 l 178 942 "},"â€¢":{"x_min":200,"x_max":780,"ha":983,"o":"m 491 789 q 694 702 609 789 q 780 493 780 615 q 695 286 780 372 q 491 200 611 200 q 285 285 370 200 q 200 493 200 370 q 221 605 200 550 q 306 725 243 661 q 491 789 368 789 "},"Â¥":{"x_min":31.3125,"x_max":684.359375,"ha":735,"o":"m 304 272 q 172 272 263 272 q 49 272 81 272 l 49 332 q 144 332 80 332 q 241 332 208 332 l 306 332 l 306 433 l 173 433 l 49 433 l 49 493 q 179 493 88 493 q 275 493 269 493 l 124 742 l 31 884 l 89 884 l 188 884 q 220 814 204 845 q 282 699 237 783 l 388 512 q 467 653 424 570 q 579 884 510 735 l 630 884 l 684 884 l 612 773 l 543 656 l 445 493 q 581 493 486 493 q 683 493 676 493 l 683 433 l 424 433 l 424 332 l 560 332 q 623 332 582 332 q 683 332 663 332 l 683 272 l 556 272 l 425 272 q 425 141 425 204 q 433 3 425 77 l 357 3 l 293 0 q 304 129 304 54 q 304 272 304 204 "},"(":{"x_min":112,"x_max":372.96875,"ha":440,"o":"m 112 388 q 172 683 112 545 q 344 949 232 821 q 372 917 353 933 q 248 660 285 781 q 211 379 211 538 q 251 103 211 231 q 372 -151 291 -24 q 344 -183 353 -166 q 169 84 227 -49 q 112 388 112 219 "},"U":{"x_min":101,"x_max":901.609375,"ha":996,"o":"m 178 928 q 225 930 192 928 q 259 932 257 932 q 247 803 247 852 q 247 696 247 755 l 247 456 q 312 134 247 212 q 506 57 377 57 q 718 129 641 57 q 795 334 795 201 l 795 458 l 795 655 q 795 797 795 733 q 782 932 795 862 q 811 927 797 929 q 842 926 825 926 q 871 929 852 926 q 901 932 890 932 q 888 778 888 852 q 888 599 888 705 l 888 366 q 781 81 888 177 q 485 -15 674 -15 q 209 66 303 -15 q 115 323 115 147 l 115 424 l 115 698 q 108 826 115 759 q 101 932 101 892 q 136 928 119 928 q 178 928 154 928 "},"Î³":{"x_min":-12,"x_max":686.75,"ha":668,"o":"m 629 647 q 686 653 655 647 q 581 439 620 520 q 493 246 542 359 l 405 48 l 405 -90 q 405 -238 405 -139 q 405 -372 405 -337 l 365 -367 q 281 -372 319 -367 q 281 -195 281 -314 q 281 -33 281 -76 q 251 191 281 46 q 164 458 221 336 q 38 580 107 580 l -12 580 l -12 607 l -12 638 q 41 662 13 653 q 98 672 69 672 q 272 554 229 672 q 388 142 316 436 q 485 392 429 243 q 577 653 541 541 q 602 648 594 649 q 629 647 610 647 "},"Î±":{"x_min":41,"x_max":810.90625,"ha":829,"o":"m 691 352 q 787 0 748 155 l 725 0 l 659 0 l 620 172 q 510 36 582 88 q 349 -15 439 -15 q 127 81 213 -15 q 41 316 41 177 q 128 569 41 467 q 361 672 216 672 q 527 622 455 672 q 646 485 598 573 q 697 651 677 569 l 755 651 l 810 651 q 748 505 776 576 q 691 352 719 434 m 369 619 q 222 530 267 619 q 178 326 178 442 q 219 124 178 214 q 360 34 261 34 q 518 137 470 34 q 589 323 565 240 q 516 531 567 444 q 369 619 466 619 "},"F":{"x_min":105.84375,"x_max":600,"ha":657,"o":"m 257 315 q 257 142 257 254 q 257 0 257 31 q 224 4 250 0 q 184 8 198 8 q 145 4 171 8 q 114 0 119 0 q 114 239 114 71 q 114 465 114 408 q 114 712 114 621 q 105 929 114 803 l 350 929 l 600 929 l 600 886 l 600 836 q 494 855 538 851 q 380 860 451 860 l 254 860 l 254 671 l 254 528 l 390 528 q 574 541 470 528 l 574 497 l 574 457 l 386 457 l 257 457 l 257 315 "},"Â­":{"x_min":0,"x_max":670,"ha":670,"o":"m 0 374 l 670 374 l 670 289 l 0 289 l 0 374 "},":":{"x_min":132,"x_max":305,"ha":437,"o":"m 219 636 q 279 611 254 636 q 304 548 304 586 q 280 486 304 512 q 219 461 256 461 q 157 486 183 461 q 132 548 132 511 q 157 610 132 584 q 219 636 182 636 m 219 156 q 279 131 254 156 q 305 69 305 107 q 280 8 305 32 q 219 -15 255 -15 q 158 9 183 -15 q 133 69 133 33 q 158 131 133 107 q 219 156 183 156 "},"Î§":{"x_min":0,"x_max":724.109375,"ha":724,"o":"m 196 286 l 311 456 q 17 932 156 717 q 62 929 32 932 q 107 926 92 926 q 164 929 144 926 q 194 932 185 932 q 290 742 239 841 q 383 567 341 644 l 479 726 q 585 932 537 824 q 615 927 601 929 q 647 926 628 926 q 679 929 657 926 q 713 932 700 932 q 603 780 660 862 q 514 652 547 699 l 419 512 q 513 347 470 419 q 602 197 555 274 q 724 0 649 119 q 672 3 705 0 q 634 7 639 7 q 583 4 605 7 q 547 0 560 1 q 449 197 502 97 q 345 398 397 298 l 259 249 q 170 96 189 130 q 125 0 152 62 q 87 3 111 0 q 61 7 63 7 q 25 4 42 7 q 0 0 9 1 l 196 286 "},"*":{"x_min":92.953125,"x_max":569.6875,"ha":662,"o":"m 331 940 q 361 944 343 940 q 383 949 379 949 q 362 851 369 902 q 356 747 356 799 q 513 874 434 801 q 538 813 530 830 q 569 779 546 797 q 379 702 477 751 q 467 661 419 680 q 565 629 515 643 q 512 534 530 587 q 433 604 470 573 q 356 661 396 634 q 363 564 356 615 q 384 460 370 514 q 354 463 373 460 q 331 467 335 467 q 301 463 320 467 q 278 460 283 460 q 299 568 291 522 q 308 661 308 615 q 151 534 218 602 q 127 589 137 569 q 97 630 117 608 q 183 661 139 643 q 282 704 227 679 q 186 746 230 729 q 92 777 143 763 q 124 818 112 795 q 148 873 136 841 q 224 806 182 840 q 308 747 265 772 q 304 810 308 784 q 278 950 301 835 q 306 943 293 946 q 331 940 319 940 "},"Â°":{"x_min":173,"x_max":498,"ha":670,"o":"m 173 888 q 223 1009 173 960 q 348 1059 274 1059 q 451 1010 405 1059 q 498 903 498 961 q 446 784 498 838 q 330 730 394 730 q 218 775 264 730 q 173 888 173 820 m 237 879 q 262 804 237 835 q 330 774 287 774 q 406 810 379 774 q 433 898 433 846 q 409 984 433 951 q 337 1017 386 1017 q 276 994 302 1017 q 243 939 250 972 q 237 879 237 905 "},"V":{"x_min":0,"x_max":835.71875,"ha":836,"o":"m 187 477 l 73 759 l 0 929 l 81 929 q 132 929 96 929 q 170 929 167 929 q 202 829 183 884 q 243 704 220 773 l 302 548 l 445 154 l 574 502 q 714 929 653 713 l 774 929 l 835 929 q 630 468 733 720 q 461 0 528 215 q 436 4 449 1 q 411 7 424 7 q 377 3 392 7 q 359 0 362 0 q 274 256 325 123 q 187 477 223 390 "},"Îž":{"x_min":57.5,"x_max":799,"ha":860,"o":"m 429 816 q 253 816 370 816 q 76 816 136 816 q 82 849 82 836 q 82 871 82 863 q 76 927 82 899 q 252 927 135 927 q 428 927 369 927 q 605 927 487 927 q 782 927 724 927 l 776 871 q 779 840 776 860 q 782 816 782 821 q 607 816 724 816 q 429 816 490 816 m 461 425 q 328 425 431 425 q 179 425 226 425 q 184 456 184 433 q 184 481 184 480 q 179 537 184 514 q 299 537 211 537 q 428 537 386 537 q 560 537 472 537 q 680 537 649 537 l 673 481 l 680 425 q 560 425 637 425 q 461 425 484 425 m 428 4 q 245 4 369 4 q 57 4 121 4 l 62 63 l 57 123 q 262 123 132 123 q 428 123 393 123 q 623 123 492 123 q 799 123 754 123 l 799 63 l 799 4 q 613 4 736 4 q 428 4 490 4 "},"Â ":{"x_min":0,"x_max":0,"ha":368},"Î«":{"x_min":-25.671875,"x_max":730.921875,"ha":694,"o":"m 289 177 l 289 387 q 186 577 230 501 q 85 747 143 652 q -25 929 28 841 q 23 929 -13 929 q 64 929 60 929 q 108 930 76 929 q 143 932 140 932 q 204 800 171 866 q 272 676 237 734 l 383 474 q 615 929 509 692 l 669 929 q 707 930 687 929 q 730 932 726 932 q 639 785 688 866 q 546 627 590 705 l 426 415 l 426 241 q 426 97 426 184 q 426 0 426 11 q 387 4 405 2 q 353 7 368 7 q 313 4 329 7 q 280 0 298 2 q 289 88 289 36 q 289 177 289 141 m 228 1208 q 280 1187 260 1208 q 301 1133 301 1166 q 279 1080 301 1103 q 228 1058 258 1058 q 176 1080 198 1058 q 154 1133 154 1103 q 176 1186 154 1164 q 228 1208 198 1208 m 465 1208 q 517 1186 496 1208 q 539 1133 539 1164 q 517 1080 539 1103 q 465 1058 496 1058 q 413 1080 435 1058 q 392 1133 392 1102 q 413 1186 392 1164 q 465 1208 434 1208 "},"0":{"x_min":48,"x_max":686,"ha":734,"o":"m 366 910 q 610 773 535 910 q 686 451 686 637 q 615 117 686 253 q 366 -19 545 -19 q 119 114 190 -19 q 48 444 48 247 q 119 775 48 640 q 366 910 190 910 m 184 366 q 223 137 184 238 q 367 37 262 37 q 449 62 413 37 q 510 142 486 88 q 542 271 535 196 q 549 456 549 346 q 517 737 549 622 q 365 852 485 852 q 241 784 275 852 q 195 647 207 717 q 184 445 184 578 l 184 366 "},"â€":{"x_min":101.65625,"x_max":559,"ha":612,"o":"m 180 857 q 207 924 188 898 q 259 951 225 951 q 314 903 309 951 q 303 856 314 881 q 277 812 293 831 l 132 567 l 101 576 l 180 857 m 424 857 q 458 928 443 905 q 505 951 473 951 q 544 938 529 951 q 559 903 559 926 q 550 859 559 881 q 524 812 541 837 l 379 567 l 348 576 l 424 857 "},"@":{"x_min":76,"x_max":1263,"ha":1339,"o":"m 886 641 l 949 641 l 858 267 l 846 205 q 867 159 846 174 q 921 144 889 144 q 1114 264 1041 144 q 1187 514 1187 385 q 1046 802 1187 694 q 721 910 905 910 q 318 754 485 910 q 151 363 151 599 q 295 2 151 136 q 665 -131 439 -131 q 885 -98 775 -131 q 1083 -3 996 -66 l 1106 -41 q 904 -149 1012 -111 q 680 -187 796 -187 q 252 -42 429 -187 q 76 351 76 101 q 267 792 76 615 q 722 970 459 970 q 1099 844 936 970 q 1263 508 1263 718 q 1163 215 1263 347 q 910 84 1064 84 q 816 104 859 84 q 774 171 774 125 l 774 203 q 694 116 746 150 q 583 82 642 82 q 430 139 482 82 q 378 303 378 197 q 461 554 378 442 q 678 666 545 666 q 782 640 739 666 q 847 557 824 614 l 886 641 m 831 478 q 780 573 817 536 q 686 610 742 610 q 518 512 579 610 q 457 297 457 414 q 493 184 457 230 q 593 139 529 139 q 718 189 665 139 q 790 314 771 239 l 831 478 "},"ÎŠ":{"x_min":-1.4375,"x_max":559.875,"ha":676,"o":"m 415 465 q 415 711 415 620 q 406 932 415 802 q 452 926 427 926 q 488 926 477 926 q 535 929 507 926 q 559 932 564 932 q 559 788 559 887 q 559 659 559 690 l 559 448 l 559 283 q 559 135 559 238 q 559 0 559 31 q 529 4 556 0 q 488 8 501 8 q 448 5 470 8 q 415 0 427 2 q 415 239 415 70 q 415 465 415 408 m 178 942 q 210 973 195 963 q 246 984 225 984 q 283 968 268 984 q 298 931 298 953 q 283 896 298 910 q 242 866 269 881 l 46 743 l -1 743 l 178 942 "},"Ã¶":{"x_min":39,"x_max":698,"ha":737,"o":"m 364 -15 q 128 79 218 -15 q 39 322 39 173 q 130 572 39 473 q 372 672 222 672 q 608 575 519 672 q 698 327 698 479 q 607 80 698 175 q 364 -15 516 -15 m 248 929 q 301 906 279 929 q 323 854 323 884 q 302 800 323 822 q 252 778 282 778 q 198 800 220 778 q 176 854 176 823 q 196 906 176 884 q 248 929 216 929 m 487 929 q 538 906 516 929 q 560 854 560 884 q 540 799 560 820 q 489 778 520 778 q 434 800 456 778 q 413 854 413 822 q 434 906 413 884 q 487 929 456 929 m 369 622 q 222 532 268 622 q 176 327 176 442 q 222 125 176 216 q 368 34 268 34 q 514 124 469 34 q 559 327 559 214 q 514 531 559 441 q 369 622 470 622 "},"i":{"x_min":91,"x_max":243,"ha":334,"o":"m 98 144 l 98 520 l 98 653 q 161 647 130 647 q 194 648 182 647 q 228 653 206 649 q 223 579 223 616 q 223 505 223 542 q 223 241 223 418 q 223 0 223 64 q 197 3 212 1 q 161 6 182 6 q 117 3 133 6 q 98 0 102 0 l 98 144 m 167 962 q 221 939 200 962 q 243 880 243 916 q 221 830 243 848 q 167 812 199 812 q 113 832 135 812 q 91 884 91 852 q 112 940 91 918 q 167 962 133 962 "},"Î’":{"x_min":110.5625,"x_max":737,"ha":786,"o":"m 116 560 q 110 932 116 759 l 203 932 q 334 932 242 932 q 432 932 426 932 q 618 880 540 932 q 696 724 696 829 q 626 578 696 632 q 456 503 557 524 q 660 438 584 489 q 737 269 737 387 q 628 69 737 135 q 376 3 519 3 l 229 3 q 160 3 208 3 q 116 3 111 3 q 116 289 116 88 q 116 560 116 489 m 255 255 l 255 146 l 255 59 l 330 59 q 516 109 441 59 q 591 266 591 160 q 514 427 591 385 q 310 469 438 469 l 255 469 l 255 255 m 559 705 q 499 831 559 786 q 355 876 439 876 l 257 876 q 248 710 248 799 l 248 522 q 468 558 377 522 q 559 705 559 595 "},"â‰¤":{"x_min":173,"x_max":943,"ha":1116,"o":"m 283 491 l 943 266 l 943 195 l 173 462 l 173 522 l 943 787 l 943 717 l 283 491 m 943 26 l 173 26 l 173 93 l 943 93 l 943 26 "},"Ï…":{"x_min":80,"x_max":691,"ha":758,"o":"m 691 397 q 586 110 691 236 q 327 -15 482 -15 q 145 54 210 -15 q 80 244 80 123 l 80 430 q 80 542 80 486 q 80 651 80 598 l 145 651 l 207 651 q 207 503 207 608 q 207 366 207 398 l 207 261 q 244 105 207 168 q 367 43 282 43 q 516 133 470 43 q 562 341 562 223 q 540 493 562 418 q 480 646 518 568 q 541 647 521 646 q 617 657 562 649 q 691 397 691 537 "},"]":{"x_min":81.734375,"x_max":326,"ha":440,"o":"m 205 -157 l 81 -157 l 81 -129 l 81 -98 q 180 -104 125 -104 l 226 -104 l 226 386 l 226 879 l 180 879 q 131 876 158 879 q 82 872 105 874 l 82 902 l 82 930 l 200 930 l 326 930 q 323 854 326 912 q 320 769 320 797 l 320 456 l 320 2 l 320 -157 l 205 -157 "},"m":{"x_min":89.90625,"x_max":1051,"ha":1144,"o":"m 94 155 l 94 494 q 94 567 94 529 q 89 654 94 606 q 152 647 121 647 l 215 654 l 215 537 q 313 637 258 604 q 442 671 367 671 q 618 545 570 671 q 720 638 664 605 q 845 672 775 672 q 1001 606 952 672 q 1051 429 1051 540 l 1051 298 l 1051 136 l 1051 0 q 1018 3 1042 0 q 987 7 993 7 q 949 3 973 7 q 926 0 926 0 q 926 202 926 68 q 926 405 926 337 q 895 536 926 486 q 792 586 865 586 q 685 539 729 586 q 636 451 641 492 q 632 375 632 409 q 632 326 632 341 l 632 313 q 632 132 632 258 q 632 0 632 7 q 596 4 610 2 q 570 5 582 5 q 532 2 559 5 q 509 0 506 0 q 509 168 509 55 q 509 320 509 280 l 509 405 q 477 533 509 481 q 374 586 445 586 q 269 540 309 586 q 222 436 229 495 q 215 313 215 376 q 215 133 215 244 q 215 0 215 22 q 180 3 204 0 q 152 7 156 7 q 115 4 132 7 q 94 0 99 1 l 94 155 "},"Ï‡":{"x_min":-1,"x_max":710.859375,"ha":698,"o":"m 490 425 q 543 535 517 475 q 595 651 569 595 l 661 651 l 710 651 q 610 506 659 585 q 509 330 562 427 l 435 196 q 563 -86 497 55 q 705 -371 630 -228 q 652 -371 687 -371 q 599 -371 616 -371 l 548 -371 q 435 -116 487 -230 q 351 71 384 -1 l 250 -96 q 174 -237 204 -175 q 122 -371 144 -300 l 61 -371 l 0 -371 q 122 -193 67 -279 q 235 -5 178 -107 l 317 135 l 197 402 q 143 518 170 460 q 42 587 101 587 l -1 582 l -1 637 q 125 672 56 672 q 218 627 177 672 q 286 521 258 582 l 352 374 l 403 259 l 490 425 "},"8":{"x_min":59,"x_max":677,"ha":734,"o":"m 109 695 q 184 852 109 797 q 364 908 260 908 q 548 853 472 908 q 625 694 625 799 q 579 575 625 621 q 459 510 533 529 l 459 498 q 619 413 562 475 q 677 247 677 351 q 587 51 677 120 q 368 -18 497 -18 q 147 48 235 -18 q 59 247 59 115 q 117 413 59 347 q 277 498 175 480 l 277 510 q 155 570 202 521 q 109 695 109 619 m 364 531 q 463 577 429 531 q 498 693 498 623 q 461 809 498 763 q 360 855 425 855 q 267 806 300 855 q 234 693 234 758 q 267 578 234 625 q 364 531 300 531 m 367 31 q 497 97 453 31 q 540 255 540 164 q 497 415 540 348 q 367 482 455 482 q 235 416 279 482 q 192 255 192 351 q 236 96 192 162 q 367 31 280 31 "},"Î¯":{"x_min":93.921875,"x_max":421,"ha":335,"o":"m 98 333 l 98 520 q 98 566 98 544 q 93 653 98 588 q 138 647 127 647 q 161 647 148 647 q 228 653 191 647 q 223 555 223 599 q 223 437 223 511 l 223 406 q 223 194 223 337 q 223 0 223 51 q 197 3 212 1 q 161 6 182 6 q 125 3 145 6 q 98 0 104 1 q 98 165 98 51 q 98 333 98 279 m 302 943 q 334 974 319 964 q 370 985 350 985 q 407 969 393 985 q 421 932 421 954 q 406 896 421 912 q 366 866 392 880 l 170 743 l 122 743 l 302 943 "},"Î–":{"x_min":7,"x_max":786,"ha":812,"o":"m 7 36 q 218 325 110 176 q 416 605 326 473 l 585 857 l 424 857 q 58 836 242 857 l 64 883 l 58 926 q 257 926 132 926 q 419 926 382 926 q 610 926 481 926 q 786 926 739 926 l 786 903 q 582 630 695 786 q 391 364 469 475 q 197 82 313 253 l 419 82 q 570 82 510 82 q 786 102 630 82 l 781 68 l 780 54 l 780 34 l 786 4 q 494 4 669 4 q 318 4 320 4 q 163 4 266 4 q 7 4 60 4 l 7 36 "},"R":{"x_min":110.5625,"x_max":791.640625,"ha":770,"o":"m 251 0 q 219 4 244 0 q 182 8 195 8 q 146 5 166 8 q 116 0 125 3 q 116 306 116 90 q 116 598 116 523 q 116 760 116 671 q 110 932 116 849 l 203 932 l 403 932 q 607 880 520 932 q 695 718 695 828 q 622 559 695 614 q 434 473 550 504 q 609 239 523 355 q 791 3 695 124 l 719 3 l 599 3 q 441 240 520 127 q 278 455 362 353 l 251 455 l 251 307 q 251 138 251 245 q 251 0 251 31 m 560 698 q 495 832 560 789 q 336 876 430 876 l 253 876 q 248 772 248 835 q 248 701 248 710 l 248 504 q 471 542 382 504 q 560 698 560 581 "},"Ã—":{"x_min":200.078125,"x_max":918.75,"ha":1116,"o":"m 873 774 l 918 728 l 604 406 l 918 86 l 873 38 l 559 361 l 242 38 l 200 86 l 514 406 l 200 728 l 242 774 l 559 454 l 873 774 "},"o":{"x_min":41,"x_max":697,"ha":738,"o":"m 364 -15 q 130 77 219 -15 q 41 321 41 171 q 131 573 41 474 q 371 672 222 672 q 607 574 518 672 q 697 325 697 477 q 606 79 697 174 q 364 -15 515 -15 m 370 619 q 222 530 268 619 q 177 327 177 441 q 223 125 177 216 q 369 34 269 34 q 515 122 470 34 q 560 325 560 210 q 515 529 560 439 q 370 619 471 619 "},"5":{"x_min":73.6875,"x_max":641,"ha":734,"o":"m 114 201 q 173 77 129 120 q 298 35 217 35 q 445 98 389 35 q 502 255 502 161 q 449 407 502 346 q 307 469 396 469 q 167 417 223 469 l 147 428 l 154 524 q 154 661 154 568 q 154 800 154 753 l 144 883 l 375 883 l 404 883 q 617 883 510 883 q 613 848 614 870 q 611 817 611 825 l 611 759 l 416 759 l 217 759 q 217 629 217 715 q 217 499 217 543 q 369 534 291 534 q 561 463 481 534 q 641 278 641 392 q 539 60 641 138 q 298 -18 438 -18 q 176 -6 227 -18 q 73 35 125 4 q 99 201 85 118 l 114 201 "},"7":{"x_min":121.109375,"x_max":716,"ha":734,"o":"m 453 554 l 575 771 l 356 771 q 127 755 228 771 q 132 786 132 769 q 132 821 132 804 q 126 885 132 853 l 401 885 l 716 885 l 716 871 q 455 429 571 641 q 247 0 338 217 l 191 8 q 151 5 167 8 q 121 0 136 3 q 210 146 176 92 q 327 339 244 201 q 453 554 409 478 "},"K":{"x_min":105.84375,"x_max":839.921875,"ha":805,"o":"m 256 314 q 256 132 256 250 q 256 0 256 14 q 224 4 250 0 q 185 9 198 9 q 145 4 171 9 q 114 0 119 0 q 114 240 114 71 q 114 465 114 408 q 114 711 114 621 q 105 932 114 802 q 150 928 122 932 q 184 925 179 925 q 227 928 200 925 q 256 932 254 932 l 256 671 l 256 498 q 473 693 372 586 q 673 932 574 800 q 718 930 697 930 q 762 930 739 930 l 820 930 q 594 727 706 830 q 381 522 483 623 q 515 358 456 426 q 653 203 574 290 q 839 -2 732 115 l 732 -2 q 679 -2 702 -2 q 631 -8 656 -2 q 561 92 599 45 q 470 204 523 140 l 256 458 l 256 314 "},",":{"x_min":39.6875,"x_max":267,"ha":366,"o":"m 129 75 q 157 147 141 120 q 209 175 173 175 q 267 119 267 175 q 254 67 267 91 q 227 18 241 43 l 72 -242 l 39 -231 l 129 75 "},"d":{"x_min":54,"x_max":658,"ha":742,"o":"m 658 762 l 658 137 l 658 -1 q 625 3 640 1 q 598 6 610 6 q 562 2 585 6 q 540 -1 540 -1 l 540 119 q 329 -15 473 -15 q 124 86 195 -15 q 54 330 54 187 q 124 569 54 467 q 326 672 195 672 q 449 643 394 672 q 540 555 503 615 l 540 755 l 540 788 l 540 818 q 530 1024 540 927 q 597 1018 564 1018 q 626 1019 616 1018 q 658 1024 637 1020 l 658 762 m 367 57 q 504 139 464 57 q 545 332 545 222 q 503 522 545 437 q 367 607 461 607 q 231 522 273 607 q 190 332 190 438 q 230 141 190 225 q 367 57 271 57 "},"Â¨":{"x_min":83,"x_max":539.96875,"ha":612,"o":"m 462 659 q 433 592 450 617 q 382 568 416 568 q 343 579 358 568 q 329 613 329 591 q 340 660 329 633 q 364 706 352 687 l 510 949 l 539 940 l 462 659 m 217 659 q 189 592 208 617 q 136 568 171 568 q 83 613 83 568 q 92 658 83 637 q 118 706 102 680 l 263 949 l 295 940 l 217 659 "},"E":{"x_min":105.84375,"x_max":600.359375,"ha":673,"o":"m 114 465 q 114 711 114 620 q 105 928 114 802 l 346 928 l 599 928 l 594 883 l 599 835 q 498 852 551 846 q 399 859 444 859 l 254 859 l 254 670 l 254 527 l 391 527 q 574 540 471 527 l 574 496 l 574 456 l 386 456 l 256 456 l 256 313 l 256 76 q 446 76 371 76 q 600 94 521 76 l 600 46 l 600 1 l 351 1 l 114 1 q 114 240 114 71 q 114 465 114 408 "},"Y":{"x_min":-27.40625,"x_max":730.890625,"ha":693,"o":"m 287 177 l 287 386 q 185 570 248 458 q 81 750 121 681 q -27 932 42 819 q 24 928 -9 932 q 62 925 58 925 q 110 927 89 925 q 144 932 131 930 q 203 800 171 866 q 270 676 235 734 l 382 475 q 499 688 442 575 q 615 932 556 801 l 669 926 q 700 927 687 926 q 730 932 714 929 q 545 627 627 769 l 426 415 l 426 240 q 426 102 426 198 q 426 0 426 5 q 393 4 417 1 q 353 7 368 7 q 312 4 327 7 q 278 0 297 2 q 287 88 287 36 q 287 177 287 140 "},"\"":{"x_min":63,"x_max":310,"ha":373,"o":"m 131 587 l 63 587 l 63 956 l 131 956 l 131 587 m 310 587 l 243 587 l 243 956 l 310 956 l 310 587 "},"Ãª":{"x_min":39,"x_max":632,"ha":666,"o":"m 398 42 q 590 129 512 42 l 609 126 q 601 90 605 109 q 597 46 597 71 q 486 0 546 14 q 361 -15 426 -15 q 127 73 215 -15 q 39 311 39 162 q 123 562 39 456 q 347 669 207 669 q 551 590 470 669 q 632 387 632 512 l 632 332 q 429 332 550 332 q 307 332 308 332 l 175 332 q 230 127 175 212 q 398 42 285 42 m 289 977 l 377 977 l 526 743 l 478 743 l 332 874 l 188 743 l 139 743 l 289 977 m 503 390 l 503 436 q 460 563 503 508 q 349 618 418 618 q 228 552 266 618 q 179 390 191 487 l 503 390 "},"Î´":{"x_min":41,"x_max":657,"ha":695,"o":"m 101 840 q 182 981 101 937 q 368 1025 264 1025 q 488 1010 428 1025 q 609 967 548 995 q 583 876 593 923 q 491 947 537 923 q 386 972 445 972 q 275 937 322 972 q 229 840 229 902 q 267 742 229 794 q 426 627 306 691 q 601 504 545 563 q 657 305 657 445 q 569 75 657 165 q 344 -15 482 -15 q 123 73 206 -15 q 41 305 41 162 q 112 526 41 430 q 301 622 183 622 q 143 726 186 674 q 101 840 101 779 m 349 576 q 217 492 257 576 q 178 302 178 409 q 219 118 178 203 q 349 34 261 34 q 481 116 442 34 q 520 307 520 198 q 480 492 520 409 q 349 576 440 576 "},"Î­":{"x_min":52,"x_max":587,"ha":616,"o":"m 497 516 q 425 591 459 566 q 346 616 392 616 q 257 580 293 616 q 221 493 221 545 q 263 407 221 438 q 365 376 305 376 l 409 376 l 409 351 l 409 314 l 338 314 q 232 279 276 314 q 189 183 189 245 q 234 76 189 116 q 345 37 279 37 q 452 65 403 37 q 534 144 501 94 q 543 98 538 121 q 557 53 548 75 q 444 1 506 18 q 316 -16 381 -16 q 132 30 212 -16 q 52 176 52 77 q 94 286 52 245 q 209 355 136 326 q 125 408 159 370 q 92 496 92 445 q 162 625 92 578 q 317 672 233 672 q 422 654 372 672 q 531 604 472 637 q 512 564 520 584 q 497 516 505 545 m 467 943 q 500 974 485 964 q 536 985 516 985 q 572 969 558 985 q 587 932 587 953 q 573 897 587 911 q 532 867 559 883 l 335 744 l 287 744 l 467 943 "},"Ï‰":{"x_min":39,"x_max":1008,"ha":1046,"o":"m 523 526 l 582 526 l 582 305 q 603 117 582 193 q 708 42 625 42 q 833 118 795 42 q 871 293 871 194 q 812 502 871 409 q 651 654 753 594 l 703 648 q 789 654 751 648 q 947 510 887 607 q 1008 304 1008 414 q 929 81 1008 178 q 728 -15 850 -15 q 609 16 664 -15 q 523 104 554 47 q 436 16 490 48 q 316 -15 381 -15 q 115 83 192 -15 q 39 311 39 182 q 98 511 39 419 q 256 654 158 604 q 296 650 272 650 q 342 650 320 650 l 393 654 q 233 501 290 592 q 176 291 176 409 q 214 116 176 191 q 340 42 252 42 q 410 68 381 42 q 451 137 438 94 q 462 216 462 175 q 462 302 462 256 q 462 418 462 352 q 462 526 462 484 l 523 526 "},"Â´":{"x_min":88.03125,"x_max":299,"ha":366,"o":"m 165 858 q 193 922 173 893 q 244 952 213 952 q 282 938 266 952 q 299 902 299 924 q 288 856 299 881 q 263 810 278 832 l 117 567 l 88 575 l 165 858 "},"Â±":{"x_min":166,"x_max":950,"ha":1116,"o":"m 591 548 l 950 548 l 950 481 l 591 481 l 591 247 l 524 247 l 524 481 l 166 481 l 166 548 l 524 548 l 524 779 l 591 779 l 591 548 m 950 33 l 166 33 l 166 100 l 950 100 l 950 33 "},"|":{"x_min":299,"x_max":368,"ha":669,"o":"m 368 449 l 299 449 l 299 956 l 368 956 l 368 449 m 368 -233 l 299 -233 l 299 272 l 368 272 l 368 -233 "},"Ï‹":{"x_min":80,"x_max":691,"ha":758,"o":"m 691 395 q 586 110 691 236 q 327 -15 481 -15 q 145 54 210 -15 q 80 244 80 123 l 80 429 q 80 542 80 486 q 80 651 80 598 l 145 651 l 207 651 q 207 502 207 608 q 207 365 207 397 l 207 261 q 244 105 207 168 q 367 43 282 43 q 516 132 470 43 q 562 340 562 222 q 540 493 562 418 q 480 646 518 568 q 541 647 520 646 q 617 657 562 649 q 691 395 691 537 m 225 928 q 278 907 256 928 q 300 852 300 886 q 279 800 300 822 q 228 778 259 778 q 173 800 195 778 q 152 852 152 822 q 173 906 152 884 q 225 928 194 928 m 462 928 q 514 906 493 928 q 536 852 536 884 q 516 799 536 821 q 465 778 496 778 q 411 800 433 778 q 390 852 390 822 q 410 905 390 883 q 462 928 430 928 "},"Â§":{"x_min":63,"x_max":608,"ha":662,"o":"m 111 36 l 125 36 q 194 -76 145 -33 q 313 -120 242 -120 q 422 -78 377 -120 q 467 27 467 -37 q 362 169 467 116 q 167 252 263 210 q 63 418 63 312 q 90 521 63 475 q 167 608 117 567 q 120 738 120 668 q 191 895 120 836 q 362 955 262 955 q 463 939 413 955 q 565 893 513 924 q 548 863 556 881 q 510 774 540 844 l 498 774 q 436 870 473 838 q 336 902 398 902 q 245 866 282 902 q 208 776 208 831 q 311 643 208 693 q 503 563 407 603 q 608 407 608 506 q 581 299 608 348 q 505 213 554 251 q 549 143 534 178 q 565 65 565 108 q 484 -112 565 -46 q 292 -178 404 -178 q 176 -163 234 -178 q 75 -120 118 -149 q 95 -42 84 -89 q 111 36 106 3 m 135 478 q 252 339 135 395 q 469 237 369 284 q 514 285 498 260 q 530 341 530 309 q 376 489 530 423 q 193 586 223 556 q 153 531 171 563 q 135 478 135 500 "},"b":{"x_min":75.828125,"x_max":688.109375,"ha":743,"o":"m 149 1017 q 215 1023 176 1017 q 207 915 207 965 q 207 788 207 865 l 207 754 l 207 555 q 410 672 277 672 q 616 569 544 672 q 688 322 688 466 q 617 79 688 173 q 405 -15 546 -15 q 289 7 342 -15 q 189 77 236 30 q 156 48 171 63 q 116 -2 141 33 l 75 -2 q 84 105 84 42 q 84 213 84 169 l 84 545 q 84 784 84 624 q 84 1023 84 943 q 149 1017 117 1017 m 375 605 q 238 520 278 605 q 197 323 197 435 q 239 132 197 217 q 375 47 281 47 q 511 131 470 47 q 552 326 552 216 q 511 519 552 434 q 375 605 470 605 "},"q":{"x_min":53,"x_max":657,"ha":743,"o":"m 595 -369 q 567 -369 579 -369 q 528 -373 556 -369 q 537 -213 537 -312 q 537 -101 537 -115 l 537 98 q 331 -15 464 -15 q 127 82 202 -15 q 53 316 53 180 q 123 564 53 456 q 324 672 193 672 q 452 636 396 672 q 542 534 507 601 q 534 655 542 594 q 574 649 564 649 q 598 649 584 649 q 657 655 627 649 l 657 433 q 657 163 657 298 q 657 -106 657 27 l 657 -373 q 629 -369 644 -370 q 595 -369 614 -369 m 365 47 q 504 133 463 47 q 545 330 545 219 q 501 514 545 433 q 364 596 456 596 q 229 512 270 596 q 189 322 189 429 q 231 132 189 217 q 365 47 273 47 "},"Î©":{"x_min":7.921875,"x_max":1095.375,"ha":1106,"o":"m 439 5 q 311 5 400 5 q 218 5 222 5 l 12 5 l 12 47 q 10 74 12 60 q 7 96 9 89 q 116 88 67 88 q 244 88 165 88 q 101 262 149 171 q 54 474 54 353 q 196 822 54 694 q 556 950 338 950 q 912 823 775 950 q 1050 474 1050 697 q 1004 262 1050 350 q 861 91 959 174 q 972 91 884 91 q 1094 91 1061 91 l 1094 34 l 1095 5 l 888 5 q 762 5 850 5 q 668 5 674 5 l 668 75 q 846 218 790 125 q 902 453 902 311 q 816 764 902 640 q 553 889 731 889 q 290 767 376 889 q 205 456 205 646 q 262 220 205 321 q 439 75 320 118 l 439 5 "},"Ï":{"x_min":80,"x_max":691,"ha":758,"o":"m 691 395 q 586 110 691 236 q 327 -15 481 -15 q 145 54 210 -15 q 80 244 80 123 l 80 429 q 80 541 80 485 q 80 650 80 597 l 145 650 l 207 650 q 207 502 207 607 q 207 365 207 397 l 207 261 q 244 105 207 168 q 367 43 282 43 q 516 132 470 43 q 562 340 562 222 q 540 492 562 416 q 480 645 518 567 q 541 646 521 645 q 617 656 562 648 q 691 395 691 536 m 491 941 q 523 972 508 962 q 558 983 538 983 q 595 967 581 983 q 609 930 609 952 q 594 895 609 910 q 555 865 580 879 l 359 742 l 311 742 l 491 941 "},"Ã–":{"x_min":50,"x_max":1048,"ha":1098,"o":"m 50 465 q 188 819 50 688 q 548 950 326 950 q 873 852 736 950 q 1026 659 1011 755 q 1044 535 1041 562 q 1048 462 1048 508 q 1045 395 1048 416 q 1026 275 1042 373 q 876 80 1011 176 q 551 -15 741 -15 q 442 -8 493 -15 q 298 31 391 -2 q 127 187 205 65 q 50 465 50 308 m 431 1209 q 481 1187 460 1209 q 503 1134 503 1165 q 481 1081 503 1104 q 431 1059 460 1059 q 378 1081 401 1059 q 355 1134 355 1103 q 377 1187 355 1165 q 431 1209 399 1209 m 667 1209 q 719 1187 698 1209 q 741 1134 741 1165 q 719 1081 741 1104 q 667 1059 698 1059 q 615 1080 636 1059 q 594 1134 594 1102 q 615 1187 594 1165 q 667 1209 636 1209 m 200 469 q 286 162 200 283 q 548 42 372 42 q 811 162 725 42 q 898 469 898 283 q 809 768 898 649 q 548 888 721 888 q 342 826 421 888 q 221 639 262 764 q 200 469 200 558 "},"z":{"x_min":15,"x_max":595,"ha":634,"o":"m 15 29 q 161 224 87 124 q 296 416 235 323 l 409 586 l 265 586 q 178 581 213 586 q 61 565 142 577 l 66 609 l 61 650 q 178 650 113 650 q 324 650 243 650 l 356 650 l 385 650 q 595 650 490 650 l 595 626 q 444 428 535 549 q 311 246 354 306 q 190 68 268 186 l 336 68 q 447 72 392 68 q 582 86 503 77 l 577 42 l 582 4 l 275 4 q 145 4 232 4 q 15 4 58 4 l 15 29 "},"â„¢":{"x_min":173,"x_max":900,"ha":1116,"o":"m 453 930 l 339 930 l 339 613 l 287 613 l 287 930 l 173 930 l 173 969 l 453 969 l 453 930 m 721 688 l 824 969 l 900 969 l 900 614 l 854 614 l 854 927 l 738 614 l 705 614 l 583 927 l 583 614 l 538 614 l 538 969 l 612 969 l 721 688 "},"Î®":{"x_min":90,"x_max":647,"ha":740,"o":"m 584 -365 q 548 -367 567 -365 q 523 -370 528 -369 q 523 -190 523 -310 q 523 -8 523 -69 l 523 406 q 490 536 523 485 q 383 587 457 587 q 251 508 285 587 q 218 314 218 430 q 218 133 218 259 q 218 1 218 8 l 155 6 l 94 1 l 94 156 l 94 495 q 92 583 94 527 q 90 655 90 639 q 116 650 102 652 q 152 648 130 648 q 181 649 171 648 q 215 655 191 650 l 215 538 q 314 637 258 602 q 444 672 370 672 q 595 603 544 672 q 647 430 647 535 l 647 328 l 647 -185 q 647 -293 647 -227 q 647 -370 647 -359 q 619 -366 634 -367 q 584 -365 604 -365 m 472 943 q 505 974 490 964 q 541 985 521 985 q 578 969 564 985 q 592 932 592 954 q 578 897 592 911 q 537 867 564 883 l 341 744 l 292 744 l 472 943 "},"Î˜":{"x_min":50,"x_max":1046,"ha":1096,"o":"m 50 465 q 189 820 50 690 q 550 950 328 950 q 875 852 739 950 q 1025 653 1010 755 q 1043 525 1040 551 q 1046 462 1046 500 q 1043 402 1046 426 q 1026 280 1040 379 q 873 83 1011 182 q 549 -15 735 -15 q 426 -7 470 -15 q 293 32 382 0 q 127 187 205 65 q 50 465 50 308 m 198 468 q 285 163 198 283 q 547 43 372 43 q 809 163 723 43 q 896 468 896 283 q 809 770 896 652 q 547 889 723 889 q 249 720 300 889 q 198 468 198 552 m 548 510 q 669 510 595 510 q 751 510 742 510 l 751 465 l 751 432 q 637 432 718 432 q 548 432 556 432 q 432 432 513 432 q 345 432 350 432 l 345 471 l 345 510 q 464 510 391 510 q 548 510 537 510 "},"Â®":{"x_min":79,"x_max":1037,"ha":1116,"o":"m 800 904 q 973 725 909 840 q 1037 481 1037 610 q 894 138 1037 282 q 556 -6 751 -6 q 221 139 363 -6 q 79 481 79 284 q 220 825 79 681 q 558 970 362 970 q 800 904 684 970 m 558 917 q 258 787 385 917 q 132 480 132 658 q 257 175 132 306 q 555 45 382 45 q 855 174 726 45 q 984 478 984 304 q 928 698 984 596 q 771 858 872 800 q 558 917 670 917 m 799 618 q 761 520 799 561 q 668 467 724 479 l 793 209 l 697 209 l 581 456 l 453 456 l 453 209 l 369 209 l 369 770 l 570 770 q 730 736 662 770 q 799 618 799 703 m 453 713 l 453 512 l 555 512 q 669 531 623 512 q 715 610 715 550 q 668 691 715 670 q 553 713 622 713 l 453 713 "},"Ã‰":{"x_min":114,"x_max":601.078125,"ha":671,"o":"m 114 465 q 114 709 114 540 q 114 930 114 879 l 350 930 l 598 930 q 597 906 597 920 q 597 885 597 892 l 597 836 q 399 859 496 859 l 254 859 l 254 669 l 254 529 l 390 529 q 575 541 483 529 q 572 517 572 529 q 572 498 572 505 q 575 449 572 464 q 478 458 532 458 q 387 458 424 458 l 254 458 l 254 316 l 254 76 q 443 76 372 76 q 601 94 514 76 l 601 46 l 601 1 l 349 1 l 114 1 q 114 244 114 73 q 114 465 114 415 m 419 1224 q 453 1254 436 1243 q 489 1266 469 1266 q 526 1250 513 1266 q 539 1211 539 1235 q 523 1175 539 1191 q 483 1146 507 1159 l 286 1023 l 237 1023 l 419 1224 "},"~":{"x_min":279,"x_max":1059,"ha":1341,"o":"m 834 650 q 654 750 747 650 q 502 850 562 850 q 389 793 423 850 q 355 650 355 737 l 279 650 q 333 846 279 768 q 499 924 387 924 q 683 824 594 924 q 837 725 773 725 q 950 779 918 725 q 983 924 983 834 l 1059 924 q 1003 727 1059 805 q 834 650 947 650 "},"Î•":{"x_min":105.84375,"x_max":600.359375,"ha":673,"o":"m 114 465 q 114 711 114 620 q 105 928 114 802 l 346 928 l 599 928 l 594 883 l 599 835 q 498 852 551 846 q 399 859 444 859 l 254 859 l 254 670 l 254 527 l 391 527 q 574 540 471 527 l 574 496 l 574 456 l 386 456 l 256 456 l 256 313 l 256 76 q 446 76 371 76 q 600 94 521 76 l 600 46 l 600 1 l 351 1 l 114 1 q 114 240 114 71 q 114 465 114 408 "},"Â³":{"x_min":47.390625,"x_max":416,"ha":485,"o":"m 156 636 l 153 663 q 175 661 164 661 q 197 661 186 661 q 274 690 243 661 q 306 767 306 719 q 208 869 306 869 q 140 846 165 869 q 105 781 115 823 l 100 778 q 83 812 92 795 q 65 845 74 830 q 132 886 96 871 q 207 901 168 901 q 334 873 278 901 q 390 778 390 845 q 348 691 390 724 q 247 643 307 658 q 366 610 317 643 q 416 509 416 578 q 347 385 416 427 q 192 343 278 343 q 47 374 115 343 q 56 422 51 391 q 65 469 62 453 l 74 469 q 118 399 86 424 q 195 374 150 374 q 289 409 250 374 q 328 500 328 444 q 293 589 328 554 q 203 624 259 624 q 176 621 190 624 q 153 617 163 618 l 156 636 "},"[":{"x_min":114,"x_max":356,"ha":439,"o":"m 119 3 l 119 386 l 119 769 l 119 930 l 232 930 l 355 930 l 355 907 l 355 872 q 257 879 308 879 l 213 879 l 213 386 l 213 -106 l 259 -106 q 323 -103 302 -106 q 356 -99 345 -100 l 356 -123 l 356 -157 l 233 -157 l 114 -157 q 116 -80 114 -137 q 119 3 119 -23 "},"L":{"x_min":105.84375,"x_max":613.609375,"ha":616,"o":"m 114 465 q 114 711 114 620 q 105 931 114 801 q 146 928 123 931 q 184 925 169 926 q 229 928 198 925 q 257 931 259 931 q 257 796 257 882 q 257 683 257 710 q 257 331 257 577 q 257 73 257 86 l 393 73 q 501 78 448 73 q 613 93 555 84 l 613 46 l 613 1 l 350 1 l 114 1 q 114 240 114 71 q 114 465 114 408 "},"Ïƒ":{"x_min":41,"x_max":786.828125,"ha":790,"o":"m 614 647 l 786 647 l 782 610 l 786 569 l 614 569 q 678 464 659 527 q 697 327 697 402 q 605 80 697 177 q 364 -15 513 -15 q 130 77 219 -15 q 41 321 41 171 q 129 571 41 471 q 365 672 218 672 q 431 665 396 672 q 499 653 467 659 q 559 647 531 647 q 614 647 587 647 m 370 619 q 223 530 268 619 q 178 325 178 442 q 220 123 178 213 q 363 34 263 34 q 512 122 465 34 q 560 325 560 210 q 515 529 560 439 q 370 619 471 619 "},"Î¶":{"x_min":73,"x_max":661,"ha":669,"o":"m 628 986 l 628 949 q 416 761 513 860 q 254 545 319 662 q 190 303 190 428 q 190 278 190 290 q 198 215 190 267 q 328 141 206 163 q 546 116 437 128 q 661 -7 661 91 q 630 -109 661 -65 q 532 -232 599 -154 l 489 -205 q 553 -113 543 -132 q 564 -66 564 -94 q 540 -20 564 -37 q 285 22 498 2 q 73 240 73 41 q 140 486 73 356 q 291 718 207 616 q 497 944 374 820 l 351 944 q 247 944 294 944 q 127 932 199 944 l 131 977 l 127 1020 q 266 1020 181 1020 q 364 1020 350 1020 q 515 1020 419 1020 q 628 1020 610 1020 l 628 986 "},"Î¸":{"x_min":48,"x_max":686,"ha":734,"o":"m 369 910 q 610 774 535 910 q 686 457 686 639 q 615 118 686 255 q 366 -19 545 -19 q 119 114 190 -19 q 48 444 48 247 q 120 774 48 639 q 369 910 193 910 m 181 384 q 217 136 181 242 q 367 30 254 30 q 524 138 495 30 q 553 425 553 245 l 401 425 l 181 425 l 181 384 m 364 859 q 253 805 295 859 q 193 674 210 751 q 183 580 183 630 q 183 481 183 530 l 317 481 q 453 481 358 481 q 554 481 548 481 q 519 747 554 636 q 364 859 484 859 "},"ÎŸ":{"x_min":50,"x_max":1046,"ha":1096,"o":"m 50 465 q 188 820 50 690 q 548 950 326 950 q 874 853 738 950 q 1025 654 1010 757 q 1043 525 1040 551 q 1046 462 1046 500 q 1043 402 1046 426 q 1025 277 1040 379 q 875 80 1010 175 q 549 -15 741 -15 q 438 -10 486 -15 q 298 29 390 -5 q 128 186 206 64 q 50 465 50 308 m 198 468 q 285 162 198 282 q 547 42 372 42 q 809 162 723 42 q 896 468 896 283 q 808 770 896 651 q 547 889 720 889 q 341 826 421 889 q 221 639 261 764 q 198 468 198 552 "},"Î“":{"x_min":105.84375,"x_max":614.96875,"ha":616,"o":"m 442 930 l 614 930 q 610 900 610 920 q 610 870 610 879 l 614 835 q 393 859 502 859 l 257 859 q 257 583 257 775 q 257 377 257 391 q 257 180 257 311 q 257 2 257 48 l 183 2 l 105 2 q 114 208 114 106 q 114 427 114 310 q 114 686 114 503 q 114 930 114 868 l 442 930 "}," ":{"x_min":0,"x_max":0,"ha":368},"%":{"x_min":27,"x_max":991,"ha":1011,"o":"m 783 0 q 633 62 693 0 q 574 218 574 124 q 634 372 574 309 q 783 436 695 436 q 931 373 871 436 q 991 223 991 310 q 976 130 991 176 q 900 35 952 70 q 783 0 847 0 m 845 1014 l 222 -126 l 154 -126 l 777 1014 l 845 1014 m 236 451 q 86 513 146 451 q 27 667 27 575 q 86 823 27 759 q 236 887 146 887 q 384 824 324 887 q 444 673 444 762 q 426 581 444 623 q 352 486 404 522 q 236 451 300 451 m 878 260 q 853 353 878 310 q 782 397 829 397 q 704 340 722 397 q 686 202 686 283 q 705 86 686 133 q 782 40 724 40 q 848 73 823 40 q 874 149 874 106 q 878 206 878 169 q 878 260 878 242 m 332 688 q 305 811 332 774 q 235 848 278 848 q 156 787 175 848 q 137 648 137 727 q 160 541 137 590 q 234 493 183 493 q 300 526 274 493 q 326 602 326 560 q 332 688 332 641 "},"P":{"x_min":110.5625,"x_max":708,"ha":722,"o":"m 116 559 q 110 930 116 759 l 230 930 q 333 930 268 930 q 409 930 397 930 q 620 870 533 930 q 708 690 708 810 q 604 490 708 561 q 365 420 501 420 l 252 420 q 252 200 252 347 q 252 0 252 52 q 220 4 245 0 q 182 8 196 8 q 145 5 166 8 q 116 0 125 2 q 116 287 116 86 q 116 559 116 488 m 565 682 q 505 823 565 771 q 358 876 446 876 l 257 876 q 250 782 250 828 q 250 689 250 736 l 250 476 q 498 529 432 476 q 565 682 565 583 "},"Î":{"x_min":-1,"x_max":1327.359375,"ha":1338,"o":"m 671 5 q 543 5 632 5 q 450 5 454 5 l 244 5 l 244 47 q 242 74 244 60 q 239 96 241 89 q 348 88 299 88 q 476 88 397 88 q 333 262 381 171 q 286 473 286 353 q 428 822 286 694 q 788 950 570 950 q 1144 823 1007 950 q 1282 473 1282 697 q 1236 262 1282 350 q 1093 91 1191 174 q 1204 91 1116 91 q 1326 91 1293 91 l 1326 34 l 1327 5 l 1120 5 q 994 5 1082 5 q 900 5 906 5 l 900 75 q 1078 218 1022 125 q 1134 453 1134 311 q 1048 764 1134 640 q 785 889 963 889 q 522 767 608 889 q 437 456 437 646 q 494 220 437 321 q 671 75 552 118 l 671 5 m 178 943 q 211 974 196 963 q 246 984 226 984 q 283 969 268 984 q 298 932 298 954 q 283 896 298 911 q 242 866 269 882 l 46 743 l -1 743 l 178 943 "},"Îˆ":{"x_min":-1.4375,"x_max":900.375,"ha":973,"o":"m 414 465 q 414 711 414 620 q 405 928 414 801 l 646 928 l 899 928 l 894 883 l 899 835 q 798 852 851 846 q 699 859 744 859 l 554 859 l 554 670 l 554 527 l 691 527 q 874 540 771 527 l 874 496 l 874 456 l 686 456 l 556 456 l 556 313 l 556 76 q 746 76 671 76 q 900 94 821 76 l 900 46 l 900 1 l 651 1 l 414 1 q 414 240 414 71 q 414 465 414 408 m 178 942 q 210 973 195 963 q 246 984 225 984 q 283 968 268 984 q 298 931 298 953 q 283 895 298 910 q 242 865 269 881 l 46 742 l -1 742 l 178 942 "},"_":{"x_min":0,"x_max":670,"ha":670,"o":"m 670 -322 l 0 -322 l 0 -255 l 670 -255 l 670 -322 "},"Îª":{"x_min":-3,"x_max":381,"ha":378,"o":"m 116 464 q 116 710 116 539 q 116 932 116 880 q 153 929 121 932 q 189 926 186 926 q 234 929 201 926 q 260 932 266 932 q 260 696 260 863 q 260 464 260 530 q 260 230 260 396 q 260 0 260 63 q 228 4 255 0 q 189 8 201 8 q 151 5 172 8 q 116 0 129 2 q 116 243 116 72 q 116 464 116 414 m 72 1208 q 121 1186 100 1208 q 143 1133 143 1164 q 121 1081 143 1105 q 72 1058 99 1058 q 19 1080 42 1058 q -3 1133 -3 1103 q 18 1185 -3 1163 q 72 1208 40 1208 m 307 1208 q 359 1186 338 1208 q 381 1133 381 1164 q 358 1080 381 1103 q 307 1058 336 1058 q 256 1080 278 1058 q 234 1133 234 1103 q 255 1185 234 1163 q 307 1208 277 1208 "},"+":{"x_min":166,"x_max":950,"ha":1116,"o":"m 590 440 l 950 440 l 950 373 l 590 373 l 590 0 l 525 0 l 525 373 l 166 373 l 166 440 l 525 440 l 525 815 l 590 815 l 590 440 "},"Â½":{"x_min":81.75,"x_max":1072.453125,"ha":1149,"o":"m 241 742 l 241 835 q 177 804 201 817 q 118 767 153 791 q 102 787 115 774 q 81 807 89 800 q 196 850 138 824 q 321 913 254 877 l 324 910 q 324 723 324 849 q 324 550 324 598 l 324 391 q 296 394 314 391 q 276 397 279 397 q 250 394 266 397 q 228 391 234 391 q 241 550 241 472 q 241 742 241 628 m 842 1014 l 911 1014 l 307 -125 l 239 -125 l 842 1014 m 963 361 q 940 442 963 411 q 870 477 917 472 q 805 457 836 477 q 769 406 774 438 l 763 377 l 758 375 q 714 448 739 416 q 882 512 785 512 q 999 475 948 512 q 1051 373 1051 438 q 936 188 1051 284 q 791 66 822 92 l 959 66 q 1072 75 1019 66 q 1069 59 1071 72 q 1067 38 1067 46 q 1072 1 1067 14 q 962 1 1036 1 q 851 1 889 1 q 776 1 826 1 q 701 1 725 1 l 701 21 q 895 195 827 122 q 963 361 963 268 "},"Î¡":{"x_min":110.5625,"x_max":708,"ha":722,"o":"m 116 559 q 110 930 116 759 l 230 930 q 333 930 268 930 q 409 930 397 930 q 620 870 533 930 q 708 690 708 810 q 604 490 708 561 q 365 420 501 420 l 252 420 q 252 200 252 347 q 252 0 252 52 q 220 4 245 0 q 182 8 196 8 q 145 5 166 8 q 116 0 125 2 q 116 287 116 86 q 116 559 116 488 m 565 682 q 505 823 565 771 q 358 876 446 876 l 257 876 q 250 782 250 828 q 250 689 250 736 l 250 476 q 498 529 432 476 q 565 682 565 583 "},"'":{"x_min":87.296875,"x_max":301,"ha":366,"o":"m 166 857 q 192 923 174 896 q 245 951 211 951 q 283 937 266 951 q 301 903 301 923 q 290 857 301 882 q 264 812 279 832 l 119 567 l 87 576 l 166 857 "},"T":{"x_min":10.78125,"x_max":698.4375,"ha":711,"o":"m 10 838 l 14 884 l 10 926 q 190 926 70 926 q 353 926 310 926 q 533 926 412 926 q 698 926 654 926 q 693 883 693 910 q 693 861 693 870 q 698 834 693 852 q 597 850 653 843 q 493 857 540 857 l 418 857 q 418 767 418 830 q 418 701 418 704 l 418 221 q 432 0 418 122 q 355 8 393 4 q 316 5 337 8 q 283 0 295 3 q 283 132 283 40 q 283 259 283 225 l 283 683 l 283 857 q 10 838 156 857 "},"Î¦":{"x_min":49,"x_max":1047,"ha":1097,"o":"m 622 -24 q 548 -15 579 -15 q 516 -17 533 -15 q 475 -24 499 -19 l 475 68 q 178 179 307 68 q 49 465 49 291 q 169 744 49 647 q 475 865 290 842 l 475 958 q 512 952 492 955 q 548 950 532 950 q 584 952 564 950 q 622 958 604 955 l 622 865 q 923 756 800 865 q 1047 460 1047 648 q 925 177 1047 279 q 622 75 804 75 l 622 -24 m 487 502 q 487 677 487 570 q 487 800 487 784 q 273 698 348 786 q 199 466 199 611 q 277 231 199 331 q 487 132 356 132 q 487 363 487 225 q 487 502 487 501 m 897 466 q 822 706 897 612 q 610 800 747 800 q 610 636 610 738 q 610 470 610 533 q 610 301 610 408 q 610 132 610 194 q 822 226 747 132 q 897 466 897 320 "},"j":{"x_min":-54,"x_max":244,"ha":335,"o":"m 104 391 q 104 542 104 444 q 104 653 104 641 q 142 647 133 647 q 165 647 151 647 q 199 648 186 647 q 233 653 211 649 q 233 507 233 595 q 233 405 233 419 l 233 -13 l 233 -109 q 153 -303 233 -234 q -54 -372 74 -372 l -54 -333 q 73 -267 42 -323 q 104 -104 104 -212 l 104 -26 l 104 391 m 168 962 q 222 939 201 962 q 244 880 244 916 q 222 830 244 848 q 168 812 200 812 q 114 832 136 812 q 92 884 92 852 q 113 940 92 918 q 168 962 134 962 "},"Î£":{"x_min":44,"x_max":774.796875,"ha":809,"o":"m 714 882 l 718 835 q 266 855 509 855 q 533 500 384 691 q 364 313 438 399 q 215 123 291 226 l 446 123 q 626 123 512 123 q 774 123 740 123 l 768 85 l 768 67 l 768 42 q 769 25 768 33 q 774 4 770 17 q 547 4 680 4 q 408 4 414 4 q 226 4 343 4 q 44 4 109 4 l 44 49 q 166 182 103 109 q 302 343 228 254 l 399 467 q 238 689 309 593 q 75 898 167 784 l 75 929 q 227 929 121 929 q 339 929 333 929 q 556 929 404 929 q 718 929 709 929 l 714 882 "},"1":{"x_min":71.203125,"x_max":455,"ha":734,"o":"m 323 625 q 323 721 323 655 q 323 792 323 788 q 224 736 274 764 q 131 673 174 709 q 101 712 122 688 q 71 742 79 736 q 269 827 174 779 q 449 934 365 874 l 455 928 q 455 551 455 803 q 455 259 455 299 l 455 0 q 413 5 433 2 q 377 8 393 8 q 342 5 361 8 q 306 0 324 2 q 323 289 323 132 q 323 625 323 445 "},"Ã¤":{"x_min":42,"x_max":642,"ha":635,"o":"m 229 -16 q 96 32 150 -16 q 42 161 42 81 q 104 302 42 272 q 297 363 166 332 q 435 447 428 395 q 395 568 435 521 q 283 616 355 616 q 187 587 228 616 q 122 507 147 559 l 93 520 l 102 590 q 198 651 141 631 q 317 672 256 672 q 490 622 435 672 q 546 454 546 572 l 546 132 q 556 68 546 83 q 605 54 566 54 q 642 57 629 54 l 642 26 q 582 5 613 14 q 526 -6 551 -3 q 430 83 444 -6 q 336 9 381 34 q 229 -16 291 -16 m 200 928 q 250 905 228 928 q 272 853 272 883 q 252 798 272 819 q 201 777 232 777 q 147 799 170 777 q 124 853 124 821 q 145 905 124 883 q 200 928 167 928 m 435 928 q 488 905 466 928 q 510 853 510 883 q 489 799 510 821 q 438 777 469 777 q 384 799 406 777 q 362 853 362 822 q 383 905 362 883 q 435 928 405 928 m 173 185 q 200 97 173 132 q 279 63 228 63 q 383 106 336 63 q 430 211 430 150 l 430 345 q 235 292 298 318 q 173 185 173 267 "},"<":{"x_min":173,"x_max":942,"ha":1116,"o":"m 275 406 l 942 130 l 942 56 l 173 379 l 173 433 l 942 756 l 942 683 l 275 406 "},"Â£":{"x_min":65,"x_max":713.796875,"ha":733,"o":"m 65 46 l 65 99 l 113 99 q 199 167 172 110 q 227 292 227 224 q 222 375 227 330 q 217 442 217 421 q 137 442 168 442 q 75 433 105 442 l 75 479 l 74 502 q 103 495 90 498 q 131 493 115 493 l 214 493 q 207 550 210 522 q 205 609 205 579 q 298 825 205 742 q 526 909 391 909 q 619 896 580 909 q 708 864 659 884 q 652 732 679 809 l 643 732 q 593 825 628 791 q 502 859 559 859 q 378 796 420 859 q 336 646 336 734 l 336 493 l 358 493 q 515 502 443 493 l 511 466 l 515 433 q 430 442 483 442 q 341 442 377 442 l 341 379 q 306 238 341 302 q 209 112 271 173 q 516 112 413 112 q 713 134 619 112 l 707 66 q 713 4 707 34 q 531 4 652 4 q 350 4 410 4 q 173 4 280 4 q 65 4 66 4 l 65 46 "},"Â¹":{"x_min":79.953125,"x_max":334,"ha":485,"o":"m 246 731 l 246 833 l 120 759 q 101 780 118 763 q 79 801 85 796 q 204 849 145 821 q 329 916 263 877 l 334 912 q 334 720 334 848 q 334 529 334 592 l 334 355 q 306 358 323 355 q 283 361 290 361 q 259 358 275 361 q 236 355 243 355 q 246 498 246 406 q 246 731 246 590 "},"t":{"x_min":17.46875,"x_max":407,"ha":417,"o":"m 17 586 l 21 630 l 17 654 q 128 643 78 643 q 128 732 128 669 q 128 798 128 795 q 194 826 159 811 q 258 862 230 842 q 248 758 248 811 q 248 643 248 705 q 328 645 306 643 q 392 654 351 647 l 392 617 l 393 586 q 241 594 317 594 l 241 258 l 241 162 q 269 76 241 109 q 347 43 297 43 q 380 45 362 43 q 407 48 397 47 l 407 4 q 343 -10 371 -5 q 286 -15 314 -15 q 175 18 219 -15 q 125 118 130 51 l 125 200 l 125 387 l 125 592 q 79 592 106 592 q 17 586 52 592 "},"Î»":{"x_min":2.296875,"x_max":639.296875,"ha":644,"o":"m 296 670 q 222 871 256 803 q 108 940 188 940 q 76 937 92 940 q 20 923 60 934 l 20 977 q 94 1012 58 999 q 167 1025 130 1025 q 322 947 281 1025 q 418 692 364 869 q 527 340 471 515 q 639 3 582 166 l 567 3 l 493 3 q 328 573 414 305 q 213 301 266 438 q 108 0 160 163 l 59 7 q 26 3 47 7 q 2 0 5 0 q 296 670 161 329 "},"Ã¹":{"x_min":91,"x_max":650.53125,"ha":739,"o":"m 641 498 q 641 329 641 443 q 641 158 641 215 q 650 0 641 81 q 619 3 634 1 q 586 6 604 6 q 552 3 571 6 q 523 0 533 1 l 523 118 q 430 18 484 52 q 304 -15 376 -15 q 143 50 195 -15 q 91 229 91 115 l 91 354 l 91 516 l 91 655 q 117 650 101 651 q 155 650 133 650 q 188 650 171 650 q 215 655 205 650 q 215 446 215 592 q 215 247 215 300 q 247 115 215 163 q 356 68 279 68 q 463 113 418 68 q 515 217 509 159 q 521 340 521 275 q 521 521 521 394 q 521 655 521 647 q 550 650 537 651 q 585 649 563 649 q 650 655 616 649 q 641 498 641 573 m 435 743 l 239 866 q 201 896 219 877 q 184 934 184 915 q 198 970 184 955 q 234 985 213 985 q 272 973 251 985 q 303 945 292 960 l 485 743 l 435 743 "},"W":{"x_min":0,"x_max":1280.8125,"ha":1281,"o":"m 0 932 q 46 927 31 929 q 74 926 61 926 q 119 929 87 926 q 152 932 151 932 q 257 547 196 749 l 372 170 q 460 437 406 272 q 541 693 514 602 q 607 932 568 784 l 658 926 q 686 928 671 926 q 711 932 702 930 q 808 604 771 727 q 865 419 845 481 q 950 170 886 356 l 1065 522 q 1120 719 1098 623 q 1163 932 1143 816 q 1197 929 1173 932 q 1222 926 1220 926 q 1254 928 1237 926 q 1280 932 1272 930 q 1109 467 1193 716 q 970 0 1024 218 q 944 4 960 1 q 918 7 928 7 q 886 3 906 7 q 862 0 865 0 q 745 385 815 184 l 628 733 l 481 287 q 394 0 430 133 q 363 3 383 0 q 337 7 343 7 q 308 4 321 7 q 281 0 296 2 q 202 296 247 143 q 119 568 157 450 q 0 932 81 686 "},"Ã¯":{"x_min":-24,"x_max":359,"ha":335,"o":"m 98 144 l 98 522 l 98 655 q 135 650 110 650 q 163 650 159 650 q 229 655 203 650 q 225 507 225 581 q 225 254 225 423 q 225 0 225 85 q 198 3 213 1 q 161 6 183 6 q 125 3 140 6 q 98 0 110 1 l 98 144 m 49 929 q 101 906 79 929 q 123 854 123 884 q 103 799 123 820 q 52 778 83 778 q -2 800 19 778 q -24 854 -24 822 q -3 906 -24 884 q 49 929 16 929 m 285 929 q 337 906 315 929 q 359 854 359 884 q 339 799 359 820 q 289 778 319 778 q 234 800 256 778 q 213 854 213 822 q 233 906 213 884 q 285 929 253 929 "},">":{"x_min":173,"x_max":943,"ha":1116,"o":"m 943 379 l 173 56 l 173 130 l 840 406 l 173 683 l 173 756 l 943 433 l 943 379 "},"v":{"x_min":0,"x_max":645.171875,"ha":641,"o":"m 0 653 q 53 647 38 647 q 84 647 68 647 q 111 647 98 647 q 164 653 125 647 q 247 402 200 528 l 351 134 l 461 435 q 532 653 498 533 q 558 649 543 650 q 588 648 574 648 q 623 648 605 648 q 645 653 639 652 q 496 340 566 502 q 364 0 427 177 q 340 5 355 2 q 313 8 326 8 q 290 5 303 8 q 266 0 277 2 q 196 205 230 120 q 0 653 161 291 "},"Ï„":{"x_min":30.375,"x_max":664.4375,"ha":688,"o":"m 416 569 l 416 303 q 416 146 416 251 q 416 0 416 42 q 387 3 403 2 q 353 3 372 3 q 327 3 338 3 q 289 0 317 3 l 289 194 l 289 573 q 154 553 204 573 q 57 471 103 534 q 30 560 49 523 q 147 629 82 612 q 302 647 212 647 l 501 647 q 593 647 535 647 q 664 647 652 647 l 659 610 q 664 569 659 587 q 518 569 607 569 q 416 569 429 569 "},"Ã»":{"x_min":91,"x_max":650.53125,"ha":739,"o":"m 641 498 q 641 329 641 443 q 641 158 641 215 q 650 0 641 81 q 619 3 634 1 q 586 6 604 6 q 552 3 571 6 q 523 0 533 1 l 523 118 q 430 18 484 52 q 304 -15 376 -15 q 143 50 195 -15 q 91 229 91 115 l 91 354 l 91 516 l 91 655 q 117 650 101 651 q 155 650 133 650 q 188 650 171 650 q 215 655 205 650 q 215 445 215 591 q 215 247 215 299 q 247 115 215 163 q 356 68 279 68 q 463 113 418 68 q 515 217 509 159 q 521 340 521 274 q 521 520 521 394 q 521 655 521 647 q 547 650 531 651 q 585 650 563 650 q 617 650 600 650 q 650 655 634 650 q 641 498 641 573 m 325 977 l 412 977 l 560 743 l 514 743 l 368 874 l 224 743 l 176 743 l 325 977 "},"Î¾":{"x_min":63,"x_max":641,"ha":642,"o":"m 551 860 q 492 941 528 910 q 406 972 456 972 q 293 917 335 972 q 251 788 251 862 q 306 649 251 700 q 449 598 362 598 l 515 598 l 515 563 l 515 527 q 473 533 495 533 q 421 533 451 533 q 267 492 332 533 q 193 406 202 452 q 184 346 185 360 q 183 325 183 332 q 183 293 183 299 q 187 281 184 287 q 234 199 197 228 q 329 152 271 170 l 485 117 q 598 72 556 99 q 641 -14 641 45 q 615 -104 641 -61 q 501 -238 590 -147 l 457 -211 q 531 -122 520 -140 q 542 -76 542 -104 q 386 15 542 -19 q 146 91 230 49 q 63 276 63 133 q 128 461 63 378 q 293 574 193 544 q 172 651 218 599 q 126 780 126 703 q 209 954 126 883 q 397 1025 293 1025 q 497 1009 449 1025 q 597 965 544 994 q 573 914 588 945 q 551 860 559 883 "},"&":{"x_min":75,"x_max":899.5,"ha":955,"o":"m 353 -18 q 157 41 240 -18 q 75 210 75 101 q 135 381 75 314 q 308 514 196 448 q 244 618 268 568 q 221 721 221 667 q 282 872 221 812 q 432 932 343 932 q 570 891 510 932 q 630 777 630 851 q 576 639 630 701 q 443 531 522 578 q 557 389 499 459 q 677 252 615 320 q 798 530 777 378 l 812 530 l 869 466 q 798 327 839 395 q 713 209 757 259 q 791 115 745 169 q 899 1 836 61 q 838 1 879 1 q 775 1 797 1 l 725 1 l 636 109 q 506 15 575 48 q 353 -18 436 -18 m 335 474 q 230 379 263 419 q 198 273 198 339 q 254 125 198 190 q 393 61 310 61 q 498 85 449 61 q 594 153 548 110 l 335 474 m 536 770 q 514 854 536 823 q 445 886 492 886 q 356 851 394 886 q 319 769 319 817 q 337 685 319 717 q 413 574 356 652 q 504 661 472 614 q 536 770 536 708 "},"Î›":{"x_min":0,"x_max":835.71875,"ha":836,"o":"m 649 452 l 762 171 l 835 2 l 754 2 q 720 2 732 2 q 665 0 707 2 q 634 101 647 54 q 593 225 620 147 l 536 382 l 393 777 l 261 428 q 187 213 221 318 q 122 1 153 107 l 61 1 l 0 1 q 201 458 93 190 q 372 931 308 725 q 396 927 385 928 q 423 926 408 926 q 450 928 432 926 q 477 931 468 931 q 537 743 500 849 q 649 452 574 637 "},"I":{"x_min":107.84375,"x_max":260.875,"ha":377,"o":"m 116 465 q 116 711 116 620 q 107 932 116 802 q 153 926 128 926 q 189 926 178 926 q 236 929 208 926 q 260 932 265 932 q 260 788 260 887 q 260 659 260 689 l 260 448 l 260 282 q 260 135 260 238 q 260 0 260 31 q 230 4 257 0 q 189 8 202 8 q 149 5 171 8 q 116 0 128 2 q 116 239 116 70 q 116 465 116 408 "},"G":{"x_min":50,"x_max":920,"ha":981,"o":"m 568 -15 q 193 107 337 -15 q 50 459 50 229 q 192 815 50 680 q 555 950 335 950 q 740 929 646 950 q 911 869 835 909 q 889 803 898 836 q 877 738 880 769 l 857 738 q 725 855 793 818 q 560 893 657 893 q 299 770 398 893 q 200 479 200 647 q 293 168 200 291 q 568 46 386 46 q 679 56 630 46 q 778 94 727 66 q 778 184 778 123 q 778 251 778 246 q 778 337 778 280 q 778 423 778 394 q 813 417 805 418 q 846 417 821 417 q 883 419 862 417 q 920 425 904 422 l 920 236 q 920 121 920 201 q 920 37 920 41 q 740 -1 823 11 q 568 -15 656 -15 "},"Î°":{"x_min":80,"x_max":691,"ha":758,"o":"m 691 395 q 586 110 691 236 q 327 -15 481 -15 q 145 54 210 -15 q 80 244 80 123 l 80 430 q 80 542 80 486 q 80 651 80 598 l 145 651 l 207 651 q 207 502 207 608 q 207 365 207 397 l 207 261 q 244 105 207 168 q 367 43 282 43 q 516 132 470 43 q 562 340 562 222 q 540 493 562 418 q 480 646 518 568 q 541 647 521 646 q 617 657 562 649 q 691 395 691 537 m 206 865 q 247 846 229 865 q 265 804 265 828 q 248 761 265 780 q 206 743 231 743 q 164 761 182 743 q 147 804 147 779 q 164 846 147 828 q 206 865 182 865 m 356 928 q 372 969 362 956 q 408 981 382 981 q 452 941 452 981 q 439 903 452 919 l 333 743 l 301 743 l 356 928 m 504 865 q 545 846 527 865 q 563 804 563 828 q 545 761 563 779 q 504 743 527 743 q 462 761 478 743 q 446 804 446 779 q 462 846 446 828 q 504 865 478 865 "},"`":{"x_min":86,"x_max":298.328125,"ha":366,"o":"m 219 659 q 192 595 211 622 q 139 568 173 568 q 86 613 86 568 q 96 660 86 636 q 121 706 106 684 l 267 949 l 298 940 l 219 659 "},"Î¥":{"x_min":-27.40625,"x_max":730.890625,"ha":693,"o":"m 287 177 l 287 386 q 185 570 248 458 q 81 750 121 681 q -27 932 42 819 q 24 928 -9 932 q 62 925 58 925 q 110 927 89 925 q 144 932 131 930 q 203 800 171 866 q 270 676 235 734 l 382 475 q 499 688 442 575 q 615 932 556 801 l 669 926 q 700 927 687 926 q 730 932 714 929 q 545 627 627 769 l 426 415 l 426 240 q 426 102 426 198 q 426 0 426 5 q 393 4 417 1 q 353 7 368 7 q 312 4 327 7 q 278 0 297 2 q 287 88 287 36 q 287 177 287 140 "},"r":{"x_min":89.90625,"x_max":459.1875,"ha":478,"o":"m 94 120 l 94 399 l 94 432 q 89 653 94 548 q 124 648 113 649 q 160 647 134 647 q 230 653 193 647 q 222 588 222 626 q 222 516 222 551 q 310 627 263 589 q 431 666 358 666 l 459 666 l 453 603 l 459 537 q 422 544 442 541 q 378 551 402 548 q 255 482 290 551 q 221 312 221 413 q 221 131 221 256 q 221 0 221 6 l 156 6 l 94 0 l 94 120 "},"x":{"x_min":1.359375,"x_max":622.03125,"ha":619,"o":"m 258 316 l 155 460 q 76 563 118 508 q 5 653 35 617 q 95 647 50 647 q 138 649 118 647 q 174 653 159 651 q 244 538 209 592 q 328 415 279 484 q 412 533 370 473 q 491 653 454 592 q 513 650 498 652 q 539 647 528 648 q 604 653 570 647 l 363 365 q 467 210 426 268 q 622 0 509 152 q 575 3 604 0 q 540 7 547 7 q 491 4 513 7 q 455 0 469 1 q 372 140 398 98 q 289 263 345 183 q 169 84 190 118 q 121 0 148 51 l 65 6 q 32 3 54 6 q 1 0 10 0 q 129 154 62 72 q 258 316 196 236 "},"Ã¨":{"x_min":39,"x_max":632,"ha":666,"o":"m 398 42 q 590 129 512 42 l 609 126 q 601 90 605 109 q 597 46 597 71 q 486 0 546 14 q 361 -15 426 -15 q 127 73 215 -15 q 39 311 39 162 q 123 562 39 456 q 347 669 207 669 q 551 590 470 669 q 632 387 632 512 l 632 332 q 429 332 550 332 q 307 332 308 332 l 175 332 q 230 127 175 212 q 398 42 285 42 m 398 743 l 203 866 q 163 895 179 880 q 147 934 147 910 q 164 967 147 949 q 198 985 182 985 q 238 969 216 985 q 267 945 260 952 l 447 743 l 398 743 m 503 390 l 503 436 q 460 563 503 508 q 349 618 418 618 q 228 552 266 618 q 179 390 191 487 l 503 390 "},"Î¼":{"x_min":88,"x_max":657.453125,"ha":739,"o":"m 326 -15 q 261 -7 288 -15 q 208 19 235 0 l 208 -127 q 208 -265 208 -177 q 208 -373 208 -354 q 180 -369 195 -370 q 148 -368 165 -368 q 112 -370 131 -368 q 88 -373 93 -372 q 88 -165 88 -304 q 88 43 88 -26 q 88 363 88 148 q 88 653 88 577 q 149 647 118 647 q 210 653 178 647 q 210 495 210 601 q 210 334 210 390 q 233 155 210 227 q 334 75 256 83 q 462 112 412 75 q 520 211 513 149 q 528 331 528 273 q 528 517 528 387 q 528 653 528 647 q 590 647 559 647 q 652 653 619 647 q 652 477 652 566 q 652 256 652 388 q 652 113 652 170 q 657 -1 652 55 l 592 4 l 528 -1 l 528 105 q 442 17 493 50 q 326 -15 390 -15 "},"Ã·":{"x_min":166,"x_max":950,"ha":1116,"o":"m 629 643 q 607 593 629 615 q 555 571 585 571 q 508 592 528 571 q 489 643 489 613 q 509 692 489 670 q 556 715 529 715 q 599 703 569 715 q 629 643 629 691 m 950 373 l 166 373 l 166 440 l 950 440 l 950 373 m 627 170 q 606 120 627 141 q 559 100 586 100 q 509 120 529 100 q 489 170 489 141 q 508 221 489 199 q 556 243 528 243 q 591 235 572 243 q 618 214 610 227 q 627 170 627 201 "},"h":{"x_min":92.921875,"x_max":651,"ha":744,"o":"m 97 136 l 97 859 q 97 934 97 894 q 92 1024 97 974 q 135 1018 125 1018 q 156 1018 144 1018 q 225 1024 186 1018 q 221 957 221 1001 q 221 888 221 913 l 221 868 l 221 542 q 319 637 261 602 q 445 672 376 672 q 601 606 552 672 q 651 429 651 541 l 651 298 l 651 136 l 651 0 q 622 3 637 1 q 587 6 607 6 q 551 3 570 6 q 526 0 531 1 q 526 202 526 68 q 526 405 526 337 q 491 533 526 481 q 386 586 457 586 q 254 508 288 586 q 221 313 221 430 q 221 133 221 244 q 221 0 221 22 q 186 3 210 0 q 161 7 163 7 q 123 5 137 7 q 97 0 109 3 l 97 136 "},".":{"x_min":98,"x_max":268,"ha":366,"o":"m 183 156 q 243 130 219 156 q 268 68 268 105 q 243 8 268 32 q 183 -15 219 -15 q 122 8 146 -15 q 98 68 98 32 q 122 130 98 105 q 183 156 146 156 "},"Ï†":{"x_min":38,"x_max":946,"ha":985,"o":"m 559 -371 q 496 -362 529 -362 q 456 -364 475 -362 q 424 -371 438 -367 q 424 -163 424 -298 q 424 -11 424 -29 q 153 76 269 -11 q 38 327 38 163 q 142 571 38 486 q 402 656 247 656 q 404 635 404 645 q 404 615 404 625 q 230 516 286 580 q 175 327 175 451 q 242 118 175 197 q 433 38 309 38 l 433 197 l 433 311 q 433 400 433 340 q 433 491 433 461 q 502 619 441 570 q 643 668 564 668 q 861 568 777 668 q 946 331 946 469 q 833 84 946 169 q 559 -15 721 0 q 559 -203 559 -72 q 559 -371 559 -334 m 809 345 q 778 533 809 450 q 662 617 748 617 q 578 571 607 617 q 550 469 550 526 l 550 348 l 550 36 q 744 123 679 36 q 809 345 809 211 "},";":{"x_min":72.390625,"x_max":307,"ha":438,"o":"m 221 636 q 282 611 257 636 q 307 548 307 586 q 282 486 307 511 q 221 461 257 461 q 160 486 185 461 q 135 548 135 512 q 159 611 135 586 q 221 636 184 636 m 162 75 q 195 157 180 140 q 241 175 211 175 q 300 119 300 175 q 291 75 300 93 q 259 18 283 56 l 102 -242 l 72 -231 l 162 75 "},"f":{"x_min":12.640625,"x_max":425.203125,"ha":390,"o":"m 120 324 l 120 596 q 64 596 88 596 q 14 589 39 596 l 14 626 l 12 654 q 79 649 38 649 q 125 649 119 649 q 189 901 125 777 q 371 1025 253 1025 q 402 1022 393 1025 q 425 1015 411 1019 l 408 895 q 365 911 388 905 q 320 918 341 918 q 248 886 273 918 q 223 805 223 855 q 231 713 223 761 q 242 650 239 665 q 325 650 272 650 q 389 650 377 650 q 385 642 387 647 q 383 633 383 637 l 381 622 l 383 611 q 389 589 383 609 q 319 596 351 596 q 247 596 287 596 l 247 366 q 247 183 247 305 q 247 0 247 61 q 210 3 235 0 q 180 7 184 7 q 142 4 159 7 q 120 0 125 1 q 120 160 120 52 q 120 324 120 268 "},"â€œ":{"x_min":83,"x_max":539.96875,"ha":612,"o":"m 462 659 q 433 592 450 617 q 382 568 416 568 q 343 579 358 568 q 329 613 329 591 q 340 660 329 633 q 364 706 352 687 l 510 949 l 539 940 l 462 659 m 217 659 q 189 592 208 617 q 136 568 171 568 q 83 613 83 568 q 92 658 83 637 q 118 706 102 680 l 263 949 l 295 940 l 217 659 "},"A":{"x_min":-14.96875,"x_max":822.109375,"ha":809,"o":"m 253 638 l 379 949 q 394 945 387 946 q 409 944 401 944 q 443 949 428 944 q 565 629 525 733 q 673 359 605 526 q 822 0 740 192 q 773 3 804 0 q 736 7 743 7 q 686 4 709 7 q 650 0 664 1 q 588 199 609 137 q 532 355 567 261 l 370 355 l 210 355 l 159 205 q 127 110 142 161 q 99 0 112 59 l 43 6 q 6 3 20 6 q -14 0 -8 0 q 74 211 29 105 q 155 403 119 317 q 253 638 191 490 m 370 422 l 502 422 l 371 760 l 240 422 l 370 422 "},"6":{"x_min":63,"x_max":678.109375,"ha":734,"o":"m 456 860 q 263 731 318 860 q 207 441 207 602 q 310 514 259 488 q 423 540 361 540 q 606 462 535 540 q 678 270 678 385 q 592 65 678 145 q 382 -15 506 -15 q 139 93 216 -15 q 63 378 63 201 q 163 746 63 582 q 451 909 264 909 q 511 906 489 909 q 565 891 533 903 l 565 828 q 511 852 536 844 q 456 860 486 860 m 542 258 q 499 409 542 347 q 372 471 456 471 q 250 409 294 471 q 206 264 206 348 q 249 105 206 172 q 378 39 292 39 q 477 73 434 39 q 531 148 520 108 q 542 206 542 187 q 542 258 542 225 "},"â€˜":{"x_min":86,"x_max":298.328125,"ha":366,"o":"m 220 659 q 190 594 209 620 q 139 568 171 568 q 86 615 86 568 q 97 660 86 633 q 121 708 109 687 l 267 951 l 298 942 l 220 659 "},"ÏŠ":{"x_min":-29,"x_max":355,"ha":335,"o":"m 98 333 l 98 520 q 98 566 98 544 q 93 653 98 588 q 137 647 127 647 q 161 647 147 647 q 228 653 191 647 q 223 555 223 599 q 223 437 223 511 l 223 406 q 223 194 223 337 q 223 0 223 51 q 196 3 211 1 q 161 6 181 6 q 124 3 145 6 q 98 0 104 1 q 98 165 98 51 q 98 333 98 279 m 44 928 q 97 907 75 928 q 119 852 119 886 q 98 800 119 822 q 47 778 78 778 q -7 800 14 778 q -29 852 -29 822 q -7 906 -29 884 q 44 928 13 928 m 281 928 q 333 906 312 928 q 355 852 355 884 q 335 799 355 821 q 284 778 315 778 q 230 800 252 778 q 209 852 209 822 q 229 905 209 883 q 281 928 249 928 "},"Ï€":{"x_min":19.5,"x_max":938.75,"ha":970,"o":"m 689 5 l 627 0 q 627 114 627 44 q 627 195 627 184 l 627 573 l 497 573 l 367 573 l 367 282 q 367 142 367 235 q 367 0 367 49 q 339 3 354 1 q 304 5 324 5 q 267 3 287 5 q 240 0 246 1 l 240 195 l 240 573 q 129 552 169 573 q 44 471 88 531 q 19 560 35 520 q 137 630 71 613 q 300 647 204 647 l 646 647 l 836 647 l 938 647 l 933 610 l 938 568 l 755 568 l 755 308 q 755 153 755 256 q 755 0 755 50 q 726 2 741 0 q 689 5 711 5 "},"Î¬":{"x_min":41,"x_max":811.390625,"ha":829,"o":"m 691 352 q 788 0 748 155 l 725 0 l 660 0 l 620 172 q 511 36 582 88 q 349 -15 439 -15 q 127 81 213 -15 q 41 316 41 177 q 128 569 41 467 q 362 672 216 672 q 527 622 456 672 q 646 485 599 573 q 698 651 678 569 l 755 651 l 811 651 q 748 505 777 576 q 691 352 720 434 m 509 942 q 542 973 526 963 q 578 984 558 984 q 614 968 600 984 q 629 931 629 952 q 615 896 629 910 q 574 866 601 882 l 376 743 l 329 743 l 509 942 m 370 619 q 222 530 267 619 q 178 326 178 442 q 219 124 178 214 q 360 34 261 34 q 518 137 470 34 q 589 323 566 240 q 517 531 567 444 q 370 619 466 619 "},"O":{"x_min":50,"x_max":1046,"ha":1096,"o":"m 50 465 q 188 820 50 690 q 548 950 326 950 q 874 853 738 950 q 1025 654 1010 757 q 1043 525 1040 551 q 1046 462 1046 500 q 1043 402 1046 426 q 1025 277 1040 379 q 875 80 1010 175 q 549 -15 741 -15 q 438 -10 486 -15 q 298 29 390 -5 q 128 186 206 64 q 50 465 50 308 m 198 468 q 285 162 198 282 q 547 42 372 42 q 809 162 723 42 q 896 468 896 283 q 808 770 896 651 q 547 889 720 889 q 341 826 421 889 q 221 639 261 764 q 198 468 198 552 "},"n":{"x_min":89.90625,"x_max":647,"ha":740,"o":"m 94 155 l 94 495 q 94 568 94 530 q 89 655 94 607 q 152 648 121 648 l 215 655 l 215 538 q 314 635 256 599 q 445 672 372 672 q 584 623 522 672 q 647 500 647 575 l 647 298 l 647 136 l 647 0 q 619 3 634 1 q 584 6 604 6 q 548 3 568 6 q 522 0 528 1 q 522 222 522 80 q 522 406 522 364 q 489 536 522 485 q 382 587 456 587 q 251 508 285 587 q 218 313 218 430 q 218 132 218 258 q 218 0 218 7 q 183 3 207 0 q 155 7 159 7 q 117 3 141 7 q 94 0 94 0 l 94 155 "},"3":{"x_min":73.03125,"x_max":631.109375,"ha":733,"o":"m 235 465 l 235 511 l 288 511 q 415 555 367 511 q 464 681 464 600 q 425 806 464 755 q 315 857 386 857 q 215 818 251 857 q 160 711 179 780 l 149 706 q 124 768 132 747 q 96 819 115 788 q 215 887 158 864 q 341 910 272 910 q 516 857 441 910 q 591 707 591 805 q 531 564 591 618 q 375 479 472 511 q 555 422 480 479 q 631 262 631 366 q 531 55 631 129 q 296 -18 432 -18 q 179 -6 235 -18 q 73 32 124 5 q 96 189 89 116 l 109 189 q 178 73 132 115 q 296 31 224 31 q 439 92 384 31 q 495 246 495 154 q 442 389 495 333 q 305 446 390 446 q 233 434 273 446 l 235 465 "},"9":{"x_min":56,"x_max":674,"ha":734,"o":"m 255 38 q 464 166 396 38 q 533 450 533 295 q 432 378 483 403 q 318 354 381 354 q 130 428 204 354 q 56 617 56 502 q 145 828 56 748 q 365 909 235 909 q 599 801 525 909 q 674 520 674 693 q 563 143 674 305 q 247 -18 452 -18 q 182 -14 206 -18 q 125 0 157 -11 l 111 90 q 176 51 140 64 q 255 38 213 38 m 364 419 q 491 482 447 419 q 535 634 535 545 q 494 790 535 725 q 366 855 453 855 q 233 791 278 855 q 189 637 189 727 q 233 482 189 545 q 364 419 278 419 "},"l":{"x_min":102,"x_max":234.4375,"ha":335,"o":"m 102 118 l 102 881 q 102 965 102 915 q 102 1024 102 1016 q 167 1018 136 1018 q 234 1024 200 1018 q 229 872 229 948 q 229 684 229 797 l 229 512 l 229 111 l 229 0 q 203 3 218 1 q 167 6 188 6 q 130 3 151 6 q 102 0 110 1 l 102 118 "},"Îº":{"x_min":98,"x_max":664,"ha":669,"o":"m 98 365 q 98 530 98 427 q 98 653 98 633 q 161 647 131 647 q 223 653 193 647 q 223 516 223 608 q 223 378 223 425 l 252 378 q 378 498 316 432 q 518 653 440 565 q 576 647 552 647 q 627 647 601 647 q 658 652 649 651 l 350 387 l 537 165 q 595 93 566 127 q 664 19 625 59 l 664 0 q 615 3 646 0 q 579 7 585 7 q 533 3 556 7 q 500 0 510 0 q 429 100 468 47 q 353 197 390 154 l 263 308 l 247 323 l 223 326 q 223 164 223 275 q 223 0 223 52 l 161 3 l 98 3 q 98 209 98 80 q 98 365 98 339 "},"4":{"x_min":38,"x_max":678.15625,"ha":734,"o":"m 441 254 l 174 254 l 38 254 l 38 290 q 200 522 108 392 q 338 721 291 653 q 465 904 386 789 l 517 904 l 570 904 q 565 805 570 872 q 560 706 560 739 l 560 345 l 588 345 q 633 345 610 345 q 678 350 656 345 l 670 297 q 672 270 670 287 q 678 244 675 254 q 558 253 616 253 l 558 137 l 558 0 l 496 7 l 428 0 q 441 121 441 51 q 441 254 441 191 m 444 767 l 337 626 q 225 465 292 562 q 141 343 159 368 l 444 343 l 444 767 "},"p":{"x_min":86,"x_max":689,"ha":743,"o":"m 86 -106 q 86 202 86 47 q 86 514 86 358 l 86 655 q 108 651 94 653 q 144 649 122 649 q 174 650 163 649 q 210 655 185 651 q 199 534 199 591 q 293 637 242 602 q 418 672 343 672 q 618 567 548 672 q 689 322 689 463 q 617 84 689 183 q 415 -15 546 -15 q 210 98 282 -15 l 210 -100 q 210 -243 210 -148 q 210 -372 210 -339 q 182 -368 197 -369 q 148 -367 167 -367 q 128 -367 136 -367 q 86 -372 121 -367 q 86 -239 86 -328 q 86 -106 86 -151 m 377 596 q 240 514 283 596 q 197 327 197 433 q 239 133 197 219 q 376 47 280 47 q 511 131 469 47 q 552 322 552 215 q 510 509 552 423 q 377 596 467 596 "},"Ïˆ":{"x_min":78,"x_max":982,"ha":1017,"o":"m 78 294 l 78 477 l 78 651 l 142 651 l 205 651 q 205 517 205 604 q 205 421 205 430 l 205 341 q 262 117 205 197 q 451 38 319 38 l 451 260 q 451 535 451 342 q 451 785 451 728 q 485 778 468 781 q 514 776 502 776 q 554 780 533 776 q 580 785 575 784 q 580 496 580 689 q 580 270 580 302 l 580 39 q 776 133 703 39 q 850 358 850 227 q 807 641 850 506 q 867 644 840 641 q 941 656 894 648 q 982 418 982 544 q 873 116 982 230 q 582 -14 765 3 l 582 -222 l 582 -372 q 549 -366 566 -368 q 514 -364 532 -364 q 480 -366 499 -364 q 450 -372 460 -369 q 450 -162 450 -302 q 450 -13 450 -22 q 190 64 303 -13 q 78 294 78 142 "},"Ãœ":{"x_min":99.109375,"x_max":900.609375,"ha":995,"o":"m 179 929 l 257 929 q 245 805 245 854 q 245 697 245 756 l 245 457 q 310 136 245 212 q 507 60 376 60 q 719 130 642 60 q 797 336 797 201 l 797 458 l 797 656 q 783 929 797 802 l 842 929 l 900 929 q 887 770 887 863 q 887 600 887 677 l 887 366 q 779 82 887 179 q 481 -15 672 -15 q 204 66 299 -15 q 110 325 110 148 l 110 426 l 110 698 q 110 805 110 756 q 99 929 110 854 l 179 929 m 403 1208 q 454 1186 434 1208 q 474 1133 474 1164 q 452 1081 474 1105 q 403 1058 430 1058 q 350 1080 373 1058 q 328 1133 328 1103 q 349 1185 328 1163 q 403 1208 371 1208 m 638 1208 q 691 1187 669 1208 q 713 1133 713 1166 q 690 1080 713 1103 q 638 1058 668 1058 q 586 1078 608 1058 q 565 1133 565 1099 q 586 1185 565 1163 q 638 1208 608 1208 "},"Ã ":{"x_min":42,"x_max":642,"ha":635,"o":"m 229 -16 q 96 32 150 -16 q 42 161 42 81 q 104 302 42 272 q 297 363 166 332 q 435 447 428 395 q 395 568 435 521 q 282 616 355 616 q 187 587 228 616 q 121 507 146 559 l 93 520 l 101 590 q 198 651 141 631 q 316 672 255 672 q 490 622 435 672 q 546 454 546 572 l 546 132 q 556 68 546 83 q 605 54 566 54 q 642 57 629 54 l 642 26 q 582 5 613 14 q 526 -6 551 -3 q 430 83 445 -6 q 336 9 381 34 q 229 -16 291 -16 m 383 742 l 187 865 q 148 895 167 876 q 130 933 130 914 q 145 969 130 954 q 182 984 160 984 q 218 971 195 984 q 249 944 240 957 l 432 742 l 383 742 m 173 185 q 200 97 173 132 q 279 63 228 63 q 383 106 336 63 q 430 211 430 150 l 430 345 q 235 292 298 318 q 173 185 173 267 "},"Î·":{"x_min":90,"x_max":647,"ha":740,"o":"m 584 -365 q 548 -367 567 -365 q 523 -370 528 -369 q 523 -190 523 -310 q 523 -8 523 -69 l 523 406 q 490 536 523 485 q 383 587 457 587 q 251 508 285 587 q 218 314 218 430 q 218 133 218 259 q 218 1 218 8 l 155 6 l 94 1 l 94 156 l 94 495 q 92 583 94 527 q 90 655 90 639 q 116 650 102 652 q 152 648 130 648 q 181 649 171 648 q 215 655 191 650 l 215 538 q 314 637 258 602 q 444 672 370 672 q 595 603 544 672 q 647 430 647 535 l 647 328 l 647 -185 q 647 -293 647 -227 q 647 -370 647 -359 q 619 -366 634 -367 q 584 -365 604 -365 "}},"cssFontWeight":"normal","ascender":1267,"underlinePosition":-133,"cssFontStyle":"normal","boundingBox":{"yMin":-373.546875,"xMin":-69,"yMax":1266,"xMax":1481},"resolution":1000,"original_font_information":{"postscript_name":"Optimer-Regular","version_string":"Version 1.00 2004 initial release","vendor_url":"http://www.magenta.gr/","full_font_name":"Optimer","font_family_name":"Optimer","copyright":"Copyright (c) Magenta Ltd., 2004","description":"","trademark":"","designer":"","designer_url":"","unique_font_identifier":"Magenta Ltd.:Optimer:22-10-104","license_url":"http://www.ellak.gr/fonts/MgOpen/license.html","license_description":"Copyright (c) 2004 by MAGENTA Ltd. All Rights Reserved.\r\n\r\nPermission is hereby granted, free of charge, to any person obtaining a copy of the fonts accompanying this license (\"Fonts\") and associated documentation files (the \"Font Software\"), to reproduce and distribute the Font Software, including without limitation the rights to use, copy, merge, publish, distribute, and/or sell copies of the Font Software, and to permit persons to whom the Font Software is furnished to do so, subject to the following conditions: \r\n\r\nThe above copyright and this permission notice shall be included in all copies of one or more of the Font Software typefaces.\r\n\r\nThe Font Software may be modified, altered, or added to, and in particular the designs of glyphs or characters in the Fonts may be modified and additional glyphs or characters may be added to the Fonts, only if the fonts are renamed to names not containing the word \"MgOpen\", or if the modifications are accepted for inclusion in the Font Software itself by the each appointed Administrator.\r\n\r\nThis License becomes null and void to the extent applicable to Fonts or Font Software that has been modified and is distributed under the \"MgOpen\" name.\r\n\r\nThe Font Software may be sold as part of a larger software package but no copy of one or more of the Font Software typefaces may be sold by itself. \r\n\r\nTHE FONT SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL MAGENTA OR PERSONS OR BODIES IN CHARGE OF ADMINISTRATION AND MAINTENANCE OF THE FONT SOFTWARE BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.","manufacturer_name":"Magenta Ltd.","font_sub_family_name":"Regular"},"descender":-374,"familyName":"Optimer","lineHeight":1640,"underlineThickness":20});

/* $Id$ */

/**
 * @projectDescription An cross-browser implementation of the HTML5 <canvas> text methods
 * @author Fabien M�nager
 * @version $Revision$
 * @license MIT License <http://www.opensource.org/licenses/mit-license.php>
 */

/**
 * Known issues:
 * - The 'light' font weight is not supported, neither is the 'oblique' font style.
 * - Optimize the different hacks (for Opera9)
 */

window.Canvas = window.Canvas || {};
window.Canvas.Text = {
  // http://mondaybynoon.com/2007/04/02/linux-font-equivalents-to-popular-web-typefaces/
  equivalentFaces: {
    // Web popular fonts
    'arial': ['liberation sans', 'nimbus sans l', 'freesans', 'optimer', 'dejavu sans'],
    'times new roman': ['liberation serif', 'helvetiker', 'linux libertine', 'freeserif'],
    'courier new': ['dejavu sans mono', 'liberation mono', 'nimbus mono l', 'freemono'],
    'georgia': ['nimbus roman no9 l', 'helvetiker'],
    'helvetica': ['nimbus sans l', 'helvetiker', 'freesans'],
    'tahoma': ['dejavu sans', 'optimer', 'bitstream vera sans'],
    'verdana': ['dejavu sans', 'optimer', 'bitstream vera sans']
  },
  genericFaces: {
    'serif': ['times new roman', 'georgia', 'garamond', 'bodoni', 'minion web', 'itc stone serif', 'bitstream cyberbit'],
    'sans-serif': ['arial', 'verdana', 'trebuchet', 'tahoma', 'helvetica', 'itc avant garde gothic', 'univers', 'futura',
                   'gill sans', 'akzidenz grotesk', 'attika', 'typiko new era', 'itc stone sans', 'monotype gill sans 571'],
    'monospace': ['courier', 'courier new', 'prestige', 'everson mono'],
    'cursive': ['caflisch script', 'adobe poetica', 'sanvito', 'ex ponto', 'snell roundhand', 'zapf-chancery'],
    'fantasy': ['alpha geometrique', 'critter', 'cottonwood', 'fb reactor', 'studz']
  },
  faces: {},
  scaling: 0.962,
  _styleCache: {}
};

/** The implementation of the text functions */
(function(){
  var isOpera9 = (window.opera && /Opera\/9/.test(navigator.userAgent)), // It seems to be faster when the hacked methods are used. But there are artifacts with Opera 10.
      proto = window.CanvasRenderingContext2D ? window.CanvasRenderingContext2D.prototype : document.createElement('canvas').getContext('2d').__proto__,
      ctxt = window.Canvas.Text;

  // Global options
  ctxt.options = {
    fallbackCharacter: ' ', // The character that will be drawn when not present in the font face file
    dontUseMoz: false, // Don't use the builtin Firefox 3.0 functions (mozDrawText, mozPathText and mozMeasureText)
    reimplement: false, // Don't use the builtin official functions present in Chrome 2, Safari 4, and Firefox 3.1+
    debug: false, // Debug mode, not used yet
    autoload: false // Specify the directory containing the face files or false
  };

  var scripts = document.getElementsByTagName("script"),
      parts = scripts[scripts.length-1].src.split('?');

  ctxt.basePath = parts[0].substr(0, parts[0].lastIndexOf("/")+1);

  if (parts[1]) {
    var options = parts[1].split('&');
    for (var j = options.length-1; j >= 0; --j) {
      var pair = options[j].split('=');
      ctxt.options[pair[0]] = pair[1];
    }
  }

  // What is the browser's implementation ?
  var moz = !ctxt.options.dontUseMoz && proto.mozDrawText && !proto.fillText;

  // If the text functions are already here or if on the iPhone (fillText exists) : nothing to do !
  if (proto.fillText && !ctxt.options.reimplement && !/iphone/i.test(navigator.userAgent)) {
    // This property is needed, when including the font face files
    return window._typeface_js = {loadFace: function(){}};
  }

  function getCSSWeightEquivalent(weight){
    switch(String(weight)) {
      case 'bolder':
      case 'bold':
      case '900':
      case '800':
      case '700': return 'bold';
      case '600':
      case '500':
      case '400':
      default:
      case 'normal': return 'normal';
      //default: return 'light';
    }
  }

  function getElementStyle(e){
    if (document.defaultView && document.defaultView.getComputedStyle) {
      return document.defaultView.getComputedStyle(e, null);
    }
    return e.currentStyle || e.style;
  }

  function getXHR(){
    if (!ctxt.xhr) {
      var methods = [
        function(){return new XMLHttpRequest()},
        function(){return new ActiveXObject('Msxml2.XMLHTTP')},
        function(){return new ActiveXObject('Microsoft.XMLHTTP')}
      ];
      for (var i = 0; i < methods.length; i++) {
        try {
          ctxt.xhr = methods[i]();
          break;
        }
        catch (e) {}
      }
    }
    return ctxt.xhr;
  }

  function arrayContains(a, v){
    var i, l = a.length;
    for (i = l-1; i >= 0; --i) if (a[i] === v) return true;
    return false;
  }

  ctxt.lookupFamily = function(family){
    var faces = this.faces, face, i, f, list,
        equiv = this.equivalentFaces,
        generic = this.genericFaces;

    if (faces[family]) return faces[family];

    if (generic[family]) {
      for (i = 0; i < generic[family].length; i++) {
        if (f = this.lookupFamily(generic[family][i])) return f;
      }
    }

    if (!(list = equiv[family])) return false;

    for (i = 0; i < list.length; i++)
      if (face = faces[list[i]]) return face;
    return false;
  }

  ctxt.getFace = function(family, weight, style){
    var face = this.lookupFamily(family);
    if (!face) return false;

    if (face &&
        face[weight] &&
        face[weight][style]) return face[weight][style];

    if (!this.options.autoload) return false;

    var faceName = (family.replace(/[ -]/g, '_')+'-'+weight+'-'+style),
        xhr = this.xhr,
        url = this.basePath+this.options.autoload+'/'+faceName+'.js';

    xhr = getXHR();
    xhr.open("get", url, false);
    xhr.send(null);
    if(xhr.status == 200) {
      eval(xhr.responseText);
      return this.faces[family][weight][style];
    }
    else throw 'Unable to load the font ['+family+' '+weight+' '+style+']';
    return false;
  };

  ctxt.loadFace = function(data){
    var family = data.familyName.toLowerCase();

    this.faces[family] = this.faces[family] || {};

    if (data.strokeFont) {
      this.faces[family].normal = this.faces[family].normal || {};
      this.faces[family].normal.normal = data;
      this.faces[family].normal.italic = data;

      this.faces[family].bold = this.faces[family].normal || {};
      this.faces[family].bold.normal = data;
      this.faces[family].bold.italic = data;
    }
    else {
      this.faces[family][data.cssFontWeight] = this.faces[family][data.cssFontWeight] || {};
      this.faces[family][data.cssFontWeight][data.cssFontStyle] = data;
    }
    return data;
  };

  // To use the typeface.js face files
  window._typeface_js = {faces: ctxt.faces, loadFace: ctxt.loadFace};

  ctxt.getFaceFromStyle = function(style){
    var weight = getCSSWeightEquivalent(style.weight),
        families = style.family, i, face;

    for (i = 0; i < families.length; i++) {
      // The iPhone adds "-webkit-" at the beginning
      if (face = this.getFace(families[i].toLowerCase().replace(/^-webkit-/, ""), weight, style.style)) {
        return face;
      }
    }
    return false;
  };

  // Default values
  // Firefox 3.5 throws an error when redefining these properties
  try {
    proto.font = "10px sans-serif";
    proto.textAlign = "start";
    proto.textBaseline = "alphabetic";
  }
  catch(e){}

  proto.parseStyle = function(styleText){
    if (ctxt._styleCache[styleText]) return this.getComputedStyle(ctxt._styleCache[styleText]);

    var style = {}, computedStyle, families;

    if (!this._elt) {
      this._elt = document.createElement('span');
      this.canvas.appendChild(this._elt);
    }

    // Default style
    this.canvas.font = '10px sans-serif';
    this._elt.style.font = styleText;

    computedStyle = getElementStyle(this._elt);
    style.size = computedStyle.fontSize;
    style.weight = getCSSWeightEquivalent(computedStyle.fontWeight);
    style.style = computedStyle.fontStyle;

    families = computedStyle.fontFamily.split(',');
    for(i = 0; i < families.length; i++) {
      families[i] = families[i].replace(/^["'\s]*/, '').replace(/["'\s]*$/, '');
    }
    style.family = families;
    return this.getComputedStyle(ctxt._styleCache[styleText] = style);
  };

  proto.buildStyle = function (style){
    return style.style+' '+style.weight+' '+style.size+'px "'+style.family+'"';
  };

  proto.renderText = function(text, style){
    var face = ctxt.getFaceFromStyle(style),
        scale = (style.size / face.resolution) * 0.75,
        offset = 0, i,
        chars = String(text).split(''),
        length = chars.length;

    if (!isOpera9) {
      this.scale(scale, -scale);
      this.lineWidth /= scale;
    }

    for (i = 0; i < length; i++) {
      offset += this.renderGlyph(chars[i], face, scale, offset);
    }
  };

  if (isOpera9) {
    proto.renderGlyph = function(c, face, scale, offset){
      var i, cpx, cpy, outline, action, length,
          glyph = face.glyphs[c] || face.glyphs[ctxt.options.fallbackCharacter];

      if (!glyph) return;

      if (glyph.o) {
        outline = glyph._cachedOutline || (glyph._cachedOutline = glyph.o.split(' '));
        length = outline.length;
        for (i = 0; i < length; ) {
          action = outline[i++];

          switch(action) {
            case 'm':
              this.moveTo(outline[i++]*scale+offset, outline[i++]*-scale);
              break;
            case 'l':
              this.lineTo(outline[i++]*scale+offset, outline[i++]*-scale);
              break;
            case 'q':
              cpx = outline[i++]*scale+offset;
              cpy = outline[i++]*-scale;
              this.quadraticCurveTo(outline[i++]*scale+offset, outline[i++]*-scale, cpx, cpy);
              break;
            case 'b':
              cpx = outline[i++]*scale+offset;
              cpy = outline[i++]*-scale;
              this.bezierCurveTo(outline[i++]*scale+offset, outline[i++]*-scale, outline[i++]*scale+offset, outline[i++]*-scale, cpx, cpy);
              break;
          }
        }
      }
      return glyph.ha*scale;
    };
  }
  else {
    proto.renderGlyph = function(c, face){
      var i, cpx, cpy, outline, action, length,
          glyph = face.glyphs[c] || face.glyphs[ctxt.options.fallbackCharacter];

      if (!glyph) return;

      if (glyph.o) {
        outline = glyph._cachedOutline || (glyph._cachedOutline = glyph.o.split(' '));
        length = outline.length;
        for (i = 0; i < length; ) {
          action = outline[i++];

          switch(action) {
            case 'm':
              this.moveTo(outline[i++], outline[i++]);
              break;
            case 'l':
              this.lineTo(outline[i++], outline[i++]);
              break;
            case 'q':
              cpx = outline[i++];
              cpy = outline[i++];
              this.quadraticCurveTo(outline[i++], outline[i++], cpx, cpy);
              break;
            case 'b':
              cpx = outline[i++];
              cpy = outline[i++];
              this.bezierCurveTo(outline[i++], outline[i++], outline[i++], outline[i++], cpx, cpy);
              break;
          }
        }
      }
      if (glyph.ha) this.translate(glyph.ha, 0);
    };
  }

  proto.getTextExtents = function(text, style){
    var width = 0, height = 0, ha = 0,
        face = ctxt.getFaceFromStyle(style),
        i, length = text.length, glyph;

    for (i = 0; i < length; i++) {
      glyph = face.glyphs[text.charAt(i)] || face.glyphs[ctxt.options.fallbackCharacter];
      width += Math.max(glyph.ha, glyph.x_max);
      ha += glyph.ha;
    }

    return {
      width: width,
      height: face.lineHeight,
      ha: ha
    };
  };

  proto.getComputedStyle = function(style){
    var p, canvasStyle = getElementStyle(this.canvas),
        computedStyle = {},
        s = style.size,
        canvasFontSize = parseFloat(canvasStyle.fontSize),
        fontSize = parseFloat(s);

    for (p in style) {
      computedStyle[p] = style[p];
    }

    // Compute the size
    if (typeof s === 'number' || s.indexOf('px') != -1)
      computedStyle.size = fontSize;
    else if (s.indexOf('em') != -1)
      computedStyle.size = canvasFontSize * fontSize;
    else if (s.indexOf('%') != -1)
      computedStyle.size = (canvasFontSize / 100) * fontSize;
    else if (s.indexOf('pt') != -1)
      computedStyle.size = fontSize / 0.75;
    else
      computedStyle.size = canvasFontSize;

    return computedStyle;
  };

  proto.getTextOffset = function(text, style, face){
    var canvasStyle = getElementStyle(this.canvas),
        metrics = this.measureText(text),
        scale = (style.size / face.resolution) * 0.75,
        offset = {x: 0, y: 0, metrics: metrics, scale: scale};

    switch (this.textAlign) {
      default:
      case null:
      case 'left': break;
      case 'center': offset.x = -metrics.width/2; break;
      case 'right':  offset.x = -metrics.width; break;
      case 'start':  offset.x = (canvasStyle.direction == 'rtl') ? -metrics.width : 0; break;
      case 'end':    offset.x = (canvasStyle.direction == 'ltr') ? -metrics.width : 0; break;
    }

    switch (this.textBaseline) {
      case 'alphabetic': break;
      default:
      case null:
      case 'ideographic':
      case 'bottom': offset.y = face.descender; break;
      case 'hanging':
      case 'top': offset.y = face.ascender; break;
      case 'middle': offset.y = (face.ascender + face.descender) / 2; break;
    }
    offset.y *= scale;
    return offset;
  };

  proto.drawText = function(text, x, y, maxWidth, stroke){
    var style = this.parseStyle(this.font),
        face = ctxt.getFaceFromStyle(style),
        offset = this.getTextOffset(text, style, face);

    this.save();
    this.translate(x + offset.x, y + offset.y);
    if (face.strokeFont && !stroke) {
      this.strokeStyle = this.fillStyle;
    }
    this.lineCap = "round";
    this.beginPath();

    if (moz) {
      this.mozTextStyle = this.buildStyle(style);
      this[stroke ? 'mozPathText' : 'mozDrawText'](text);
    }
    else {
      this.scale(ctxt.scaling, ctxt.scaling);
      this.renderText(text, style);
      if (face.strokeFont) {
        this.lineWidth = 2 + style.size * (style.weight == 'bold' ? 0.08 : 0.015) / 2;
      }
    }

    this[(stroke || (face.strokeFont && !moz)) ? 'stroke' : 'fill']();

    this.closePath();
    this.restore();

    if (ctxt.options.debug) {
      var left = Math.floor(offset.x + x) + 0.5,
          top = Math.floor(y)+0.5;

      this.save();
      this.strokeStyle = '#F00';
      this.lineWidth = 0.5;
      this.beginPath();

      // Text baseline
      this.moveTo(left + offset.metrics.width, top);
      this.lineTo(left, top);

      // Text align
      this.moveTo(left - offset.x, top + offset.y);
      this.lineTo(left - offset.x, top + offset.y - style.size);

      this.stroke();
      this.closePath();
      this.restore();
    }
  };

  proto.fillText = function(text, x, y, maxWidth){
    this.drawText(text, x, y, maxWidth, false);
  };

  proto.strokeText = function(text, x, y, maxWidth){
    this.drawText(text, x, y, maxWidth, true);
  };

  proto.measureText = function(text){
    var style = this.parseStyle(this.font),
        dim = {width: 0};

    if (moz) {
      this.mozTextStyle = this.buildStyle(style);
      dim.width = this.mozMeasureText(text);
    }
    else {
      var face = ctxt.getFaceFromStyle(style),
          scale = (style.size / face.resolution) * 0.75;

      dim.width = this.getTextExtents(text, style).ha * scale * ctxt.scaling;
    }

    return dim;
  };
})();
