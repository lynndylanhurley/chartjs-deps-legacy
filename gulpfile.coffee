gulp = require('gulp')
del  = require('del')

$ = require('gulp-load-plugins')()

gulp.task 'default', ->
  del('dist')

  gulp.src([
    'src/excanvas.js'
    'src/canvas-text.js'
    'src/optimizer-normal-normal.js'
  ], {base: 'src'})
    .pipe($.concat('chartjs-deps-legacy.js'))
    .pipe($.uglify())
    .pipe(gulp.dest('dist'))
