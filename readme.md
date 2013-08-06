# vz.touch

A cross-browser unified click/touch handling library from
[Vizify](https://www.vizify.com).  It's small, it's fast, it solves
all your problems.

It has no dependencies and works right against the DOM API.  Older
versions of IE are not supported.

## Example

```javascript
vz.touch($('#mything'), {
  click: function(e) {
    alert('Clicked!')
  }
});
```

## What it does

There are a few buckets of functionality `vz.touch` provides:

 * Provides a normalized interface across touch and click events
 * Provides useful extra information with its events (e.g. cursor position)
 * Works around browser bugs

With the exception of the Android 4.x stock browser, `vz.touch` supports
touch and click events *in tandem*, so if you've got, say, a touchscreen
laptop with a mouse plugged in, you can use either with no problems.

One of the main benefits you'll get from `vz.touch` is that it handles
any combination of events easily, which is a bit of a feat if you're
trying to do it yourself.  For example, you can bind `click` and `drag`
and both will be fired just as you expect.  It's non-trivial to accomplish.

The short version of all this: `vz.touch` does nothing magical.  It just
slogs through the muck so you get the best available touch/click support
with a nice API, without having to work for it.  It's the touch library
you'd write if you had the time.

## How events are fired

**click**
Native `click` event, or `touchstart` is followed by a `touchend` with
less than `DRAG_THRESHOLD` (3px) amount of movement in between.

**down**
Native `mousedown` or `touchstart` events.

**up**
Native `mouseup` or `touchend` events.

**drag**
No native equivalent; if a `down` is followed by enough mouse movement
drag mode will be entered until an `up`.  Important: the drag will
continue even if it goes out of the bounds of the original element
the drag started on.  This is the behavior you want, because it prevents
UI janks from prematurely ending the drag.

## API

```javascript
// Bind
var killer = vz.touch(el, options, events);
// Unbind
killer();
```

 * `el` - Either a DOM element or an Array-like list of DOM elements (e.g.
          jQuery, `Array`, `NodeList`) to bind events to.
 * `options` - **optional** Options map.  Currently there are no options...
 * `events` - Map of events to fire.  See above section for supported
              event names

The return value is a killer function that should be called once to
unbind the events.

**Note:** Calling `vz.touch` more than once on the same element will
          result in weird behavior.  Don't do it!

Event handlers are supplied a single event argument, just like a native
handler.  Similarly, `this` inside a handler will be set to the element
that triggered the event.  Note that, unlike a native event handler,
`preventDefault()` has already been called.  A dummy one exists on the
event argument for backwards compatibility, but it does nothing.

### The event object

This guy's custom.  Here's the spec:

```javascript
{
  preventDefault: Function, // Does nothing
  stopPropagation: Function, // Native stopPropagation functionality
  target: Element, // Source of the event,
  absolute: {
    t: Number, // Unix timestamp the event occurred at
    x: Number, // Window X coordinate of the event
    y: Number // Window Y cooridnate of the event
  },

  // These properties appear on drag events only
  relative: {
    t: Number, // Milliseconds elapsed since the start of the drag
    x: Number, // Pixels dragged along the X axis during the drag
    y: Number // Pixels dragged along the Y axis during the drag
  },
  delta: {
    t: Number, // Milliseconds since the last drag event
    x: Number, // Pixels dragged along the X axis since the last drag event
    y: Number // Pixels dragged along the Y axis since the last drag event
  },
  dragState: Number // 0 for starting (fired on first drag event)
                    // 1 for continuing
                    // 2 for ending (fired on last drag event)
}
```

## License

Public domain, see licence.txt for details.

Developed at and opened sourced by [Vizify](https://www.vizify.com), from Portland with love.
