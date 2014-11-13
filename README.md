# Why?

This package enables the use of [ChartJS](http://www.chartjs.org/) with IE8. 

The steps from [this document](https://github.com/danielhusar/Chart.js/blob/master/docs/07-Notes.md) have been combined into a simple `bower install`.


# Installation

~~~bash
$ bower install chartjs-deps-legacy --save
~~~

# Usage

### html
~~~html
<!--[if lte IE 8]>
<script src="/bower_components/chartjs-deps-legacy/dist/chartjs-deps-legacy.js"></script>
<![endif]-->

<script src="/bower_components/chartjs/Chart.js"></script>
~~~

### javascript
~~~javascript
// find the target element
var el = document.getElementById('target');

// create canvas object
c        = document.createElement('canvas');
c.width  = 600;
c.height = 400;
opts     = {};

// only use excanvas when necessary
if (!c.getContext) {
  // animations are NOT POSSIBLE in IE8!
  opts.animation = false
  c = G_vmlCanvasManager.initElement(c)
}

// this only works after page-reflow
setTimeout(function() {

  // create ChartJS object
  var ctx   = c.getContext('2d');
  var graph = new Chart(ctx);

  // plug in chart data
  var graph.Line(scope.ngModel, opts);

}, 0);

// append chart to element
el.appendChild(c);
~~~

# Development

1. pull down this repo

   `$ git clone git@github.com:lynndylanhurley/chartjs-deps-legacy.git`
   
1. install the build deps

   `$ npm install`

1. navigate to repo root

   `$ cd chartjs-deps-legacy`

1. concatenate and minify dependencies from `src` into `dist`

   `$ gulp`
