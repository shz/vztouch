'use strict';

//
// Quick usage:
//
//     vz.touch(el, [options], events);
//
//  * el - A DOM element, or array-like container of DOM elements (e.g.
//         jQuery, Array, NodeList).
//
//  * options - Optional map of options to use.  See below for details.
//
//  * events - Map of events to bind.  Supported events: click down up
//             drag.
//
// Event handler work largely like regular old DOM event handlers.  The
// `this` object is set to the target of the event, and a single event
// argument is passed through defined below.  Note that `preventDefault`
// is always called before the event is passed to the handler, but a
// dummy `preventDefault` method is still provided for compatibility.
//
// Event interface:
// {
//   stopPropagation: function,
//   preventDefault: dummy function,
//   target: target element,
//   absolute/relative/delta: {
//     t: time
//     x: window x position
//     y: window y position
//   }
//   dragState: 0|1|2 // starting, continuing, ended
// }
//
// Note that relative, delta, and dragState ONLY appear for drag events
//
// Options:
//
//   * `selector` - If present,
//     events will only be handled if the target matches `selector`.  This
//     can to used to, for example, bind vztouch to `document.body` and
//     handle events on all `a` tags.  Note that this requires recent
//     browsers in order to function, notably IE9+.
//
//   * `dragDirection` - If `'vertical'` or `'horizontal'`, dragging is
//     locked to that particular axis.  Attempting to drag in the other
//     direction will cause native browser behavior (e.g. scrolling on
//     a mobile device).
//

(function() {

  ///////////////////////////////////////////////
  // Utility
  ///////////////////////////////////////////////

  var matchesSelector = function() {
    var name = undefined;
    var prefixii = 'webkit moz ms o'.split(/\s+/);
    return function(el, sel) {
      if (name === undefined) {
        name = null;

        if (typeof el.matches == 'function') {
          name = 'matches';
        } else {
          prefixii.forEach(function(p) {
            if (typeof el[p + 'MatchesSelector'] == 'function')
              name = p + 'MatchesSelector';
          });
        }
      } else if (name === null) {
        return false;
      } else {
        return el[name](sel);
      }
    };
  }();

  ///////////////////////////////////////////////
  // Internal flags
  ///////////////////////////////////////////////

  // When true, click events will be fully emulated and the native
  // click event never bound.
  var ignoreNativeClick = false;

  // Sets how many pixels along an axis must be moved to consider an
  // action a drag.
  var DRAG_THRESHOLD = 3;

  // If we're using the stock android browser, we *cannot* bind to
  // click events because the touch events cannot be properly cancelled.
  if (navigator.userAgent.match(/Android/) && !navigator.userAgent.match(/Firefox|Chrome/))
    ignoreNativeClick = true;

  // Does extra logging when set
  var DEBUG = false;

  /////////////////////////////////////////////
  // Public Interface
  /////////////////////////////////////////////

  // Ensure namespace exists
  if (!window.vz)
    window.vz = {};

  // Event types: down, up, drag, click
  vz.touch = function(el, opts, events) {
    // Sanity
    if (!el || el.length === 0)
      return function() {};

    // Handle jQuery, arrays, etc
    if (el.length) {
      var cleanups = [];
      for (var i=0; i<el.length; i++)
        cleanups.push(vz.touch(el[i], opts, events));
      return function() {
        for (var i=0; i<cleanups.length; i++)
          cleanups[i]();
      };
    }

    // Opts is optional
    if (!events) {
      events = opts;
      opts = undefined;
    }
    if (!opts)
      opts = {};

    // If events is a function, treat it as shorthand syntax for just
    // binding click.
    if (typeof events == 'function')
      events = {click: events};

    // Validate events and options
    for (var i in events) if (events.hasOwnProperty(i))
      if (['down', 'up', 'drag', 'click'].indexOf(i) < 0)
        throw new Error('Unsupported event "' + i + '"');
    for (var i in opts) if (opts.hasOwnProperty(i))
      if (['dragDirection', 'selector'].indexOf(i) < 0)
        throw new Error('Unsupported option "' + i + '"');

    ////////////////////////////////////////////////////
    // Implementation
    ////////////////////////////////////////////////////

    // Drag state
    var dragInfo = {
      // Start pos
      sx: 0,
      sy: 0,
      // Current pos
      x: 0,
      y: 0,
      // Total movement
      tx: 0,
      ty: 0,

      // Start time
      sd: 0,
      // Current time
      d: 0,
      // Total time
      td: 0,

      // Target drag element
      target: null,

      // Current drag state
      state: 0,
    };

    // Gets controlled by drag and touch events.  When drag goes over
    // a threshold the next click is ignored.  When a touchend finishes
    // WITHIN threshold it will fire click instantly and set this so
    // that the regular touch event doesn't occur.
    var ignoreThisClick = false;

    // Gets toggled by the drag listener if directional dragging is enabled
    var ignoreThisDrag = false;

    // When true, drag events are bound to the window.  Reset after
    // a drag ends.
    var dragEventsBound = true;

    // When true, we have sent a drag event to the user and will need
    // to follow up by sending a final null drag to signal the end.
    var dragFired = false;

    // Special handler for preventing text selection while dragging
    var selectionKiller = function(e) {
      if (DEBUG)
        console.log('selectionKiller');

      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    // Gets the window position of an event
    var getPosX = function(e) {
      if (e.touches && e.touches.length)
        return e.touches[0].pageX;
      else if (!e.touches && typeof e.pageX == 'number')
        return e.pageX;
      else if (!e.touches && typeof e.clientX == 'number')
        return e.clientX + document.body.scrollLeft;
      else
        return undefined;
    };
    var getPosY = function(e) {
      if (e.touches && e.touches.length)
        return e.touches[0].pageY;
      else if (!e.touches && typeof e.pageY == 'number')
        return e.pageY;
      else if (!e.touches && typeof e.clientY == 'number')
        return e.clientY + document.body.scrollTop;
      else
      return undefined;
    };

    // Special handler for ending drags regardless of where the cursor is
    var dragEnder = function(e) {
      if (DEBUG)
        console.log('dragEnder', e ? e.type : undefined);

      window.removeEventListener('mousemove', drag, false);
      window.removeEventListener('touchmove', drag, false);
      window.removeEventListener('mouseup', dragEnder, true);
      window.removeEventListener('touchend', dragEnder, true);
      window.removeEventListener('selectstart', selectionKiller, true);

      if (dragEventsBound) {
        dragEventsBound = false;
        if (events.drag && dragFired) {
          dragFired = false;
          var data = {
            stopPropagation: function() { e && e.stopPropagation() },
            preventDefault: function() {},
            target: dragInfo.target,
            absolute: {x: dragInfo.x, y: dragInfo.y, t: +new Date()},
            relative: {x: dragInfo.x - dragInfo.sx,
                       y: dragInfo.y - dragInfo.sy,
                       t: (+new Date()) - dragInfo.st
                      },
            delta: {x: 0, y: 0, t: (+new Date()) - dragInfo.t},
            dragState: 2
          };
          if (opts.dragDirection == 'horizontal') {
            data.absolute.y =
            data.relative.y =
            data.delta.y = 0;
          } else if (opts.dragDirection == 'vertical') {
            data.absolute.x =
            data.relative.x =
            data.delta.x = 0;
          }
          events.drag.call(dragInfo.target, data);
        }
      }
    };

    var down = function(e) {
      if (DEBUG)
        console.log('down', e.type);
      if (opts.selector && !matchesSelector(e.target, opts.selector))
        return;

      // Ignore multitouches or non-primary mousebutton clicks
      if ((e.touches && e.touches.length > 2) || (e.button !== undefined && e.button !== 0))
        return;

      // This is the start of a new click; don't ignore it
      ignoreThisClick = false;

      // If the user's listening for down events, pass on through
      if (events.down) {
        e.preventDefault();
        events.down.call(this, {
          stopPropagation: function() { e.stopPropagation(); },
          preventDefault: function() {},
          target: e.target,
          absolute: {
            x: getPosX(e),
            y: getPosY(e),
            t: +new Date()
          }
        });
      }

      // Re-enable drag listenering
      ignoreThisDrag = false;

      // For dragging via mouse-type events, disable text selection.
      if (events.drag && e.type == 'mousedown') {
        e.preventDefault();
      }

      // For drag events bootstrap the position and element.  Touchstart
      // is similar, because we need to track the start of a potential
      // "click" event.
      if (events.drag || e.type == 'touchstart') {

        // Set drag starting coordinates
        dragInfo.sx = getPosX(e);
        dragInfo.sy = getPosY(e);
        dragInfo.x = dragInfo.sx;
        dragInfo.y = dragInfo.sy;
        dragInfo.tx = 0;
        dragInfo.ty = 0;
        dragInfo.t = dragInfo.st = +new Date();
        dragInfo.target = e.target;
        dragInfo.state = 0;

        // Bind to drag events
        window.addEventListener('mousemove', drag, false);
        window.addEventListener('touchmove', drag, false);
        window.addEventListener('mouseup', dragEnder, true);
        window.addEventListener('touchend', dragEnder, true);
        window.addEventListener('selectstart', selectionKiller, true);
        dragEventsBound = true;
      }
    };

    var up = function(e) {
      if (DEBUG)
        console.log('up', e.type);
      if (opts.selector && !matchesSelector(e.target, opts.selector))
        return;

      var x = 0;
      var y = 0;
      if (events.click || events.up) {
        x = getPosX(e);
        y = getPosY(e);
        if (!x && x !== 0)
          x = dragInfo.x;
        if (!y && y !== 0)
          y = dragInfo.y;
      }

      // If the user's listening for up events, pass on through
      if (events.up) {
        e.preventDefault();
        events.up.call(this, {
          stopPropagation: function() { e.stopPropagation(); },
          preventDefault: function() {},
          target: e.target,
          absolute: {
            x: x,
            y: y,
            t: +new Date()
          }
        });
      }

      // Optimized click delivery
      if (events.click && !ignoreThisClick) {
        // If we're ignoring native click, simulate a click event.
        // Similarly, if this event came from a touchend, we can trigger
        // our own click and ignore the real click event, which will
        // give snappier performance.
        if (ignoreNativeClick || e.type == 'touchend') {
          e.preventDefault();
          ignoreThisClick = true;
          events.click.call(this, {
            stopPropagation: function() { e.stopPropagation(); },
            preventDefault: function() {},
            target: e.target,
            absolute: {
              x: x,
              y: y,
              t: +new Date()
            }
          });
        }
      }
    };

    var click = function(e) {
      if (DEBUG)
        console.log('click', e.type);
      if (opts.selector && !matchesSelector(e.target, opts.selector))
        return;

      if (!ignoreThisClick && events.click) {
        e.preventDefault();
        events.click.call(this, {
          stopPropagation: function() { e.stopPropagation() },
          preventDefault: function() {},
          target: e.target,
          absolute: {
            x: getPosX(e),
            y: getPosY(e),
            t: +new Date()
          }
        });
      }
    };

    var drag = function(e) {
      if (DEBUG)
        console.log('drag', e.type);

      // Don't handle multitouch
      if (e.touches && e.touches.length > 1)
        return;

      // If we're ignoring the drag, there's nothing to do
      if (ignoreThisDrag)
        return;

      // New position
      var nx = getPosX(e);
      var ny = getPosY(e);

      // New date
      var nt = +new Date();

      // Prep the data to pass to the client
      var data = {
        stopPropagation: function() { e.stopPropagation() },
        preventDefault: function() {},
        target: dragInfo.target,
        absolute: {x: nx, y: ny, t: nt},
        relative: {x: nx - dragInfo.sx, y: ny - dragInfo.sy, t: nt - dragInfo.st},
        delta: {x: nx - dragInfo.x, y: ny - dragInfo.y, t: nt - dragInfo.t},
        dragState: dragInfo.state
      };

      // When limiting to one axis, ignore the other axis' values
      if (opts.dragDirection == 'horizontal') {
        data.absolute.y =
        data.relative.y =
        data.delta.y = 0;
      } else if (opts.dragDirection == 'vertical') {
        data.absolute.x =
        data.relative.x =
        data.delta.x = 0;
      }

      // Update the last position
      dragInfo.t = nt;
      dragInfo.x = nx;
      dragInfo.y = ny;
      dragInfo.tx += Math.abs(data.delta.x);
      dragInfo.ty += Math.abs(data.delta.y);

      // If we're limiting dragging to one axis, check for the direction of the first
      // drag event to make a decision.
      if (data.dragState == 0) {
        if (opts.dragDirection == 'vertical') {
          if (dragInfo.ty < dragInfo.tx) {
            ignoreThisDrag = true;
            return;
          }
        } else if (opts.dragDirection == 'horizontal') {
          if (dragInfo.tx < dragInfo.ty) {
            ignoreThisDrag = true;
            return;
          }
        }
      }

      // When true, we've passed the drag threshold and are treating
      // this drag as a drag and not a sloppy click.
      var overThreshold = (dragInfo.tx > DRAG_THRESHOLD) || (dragInfo.ty > DRAG_THRESHOLD);

      // If we've moved more than the drag threshold on either axis, stop
      // click from happening.
      if (!ignoreThisClick && overThreshold)
        ignoreThisClick = true;

      // If we've moved more than the drag treshold on the configured
      // axis (both by default), prevent native scroll from working and
      // then drigger the drag business.
      if (events.drag && overThreshold) {
        e.preventDefault();

        // Pass the drag event on down
        if (events.drag) {
          events.drag.call(dragInfo.target, data);
          dragFired = true;
          dragInfo.state = 1;
        }
      }
    };

    // Bind all our events
    el.addEventListener('touchstart', down, false);
    el.addEventListener('touchend', up, false);
    if (!ignoreNativeClick) {
      el.addEventListener('mousedown', down, false);
      el.addEventListener('mouseup', up, false);
      el.addEventListener('click', click, false);
    }

    // Return a cleanup function
    return function() {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchend', up);
      if (!ignoreNativeClick) {
        el.removeEventListener('mousedown', down);
        el.removeEventListener('mouseup', up);
        el.removeEventListener('click', click);
      }

      if (dragEventsBound) {
        dragEventsBound = false;
        dragEnder();
      }
    };
  };
})();
