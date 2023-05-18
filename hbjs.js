function hbjs(instance) {
  'use strict';

  var exports = instance.exports;
  var heapu8 = new Uint8Array(exports.memory.buffer);
  var heapu32 = new Uint32Array(exports.memory.buffer);
  var heapi32 = new Int32Array(exports.memory.buffer);
  var heapf32 = new Float32Array(exports.memory.buffer);
  var utf8Decoder = new TextDecoder("utf8");

  var HB_MEMORY_MODE_WRITABLE = 2;
  var HB_SET_VALUE_INVALID = -1;

  function hb_tag(s) {
    return (
      (s.charCodeAt(0) & 0xFF) << 24 |
      (s.charCodeAt(1) & 0xFF) << 16 |
      (s.charCodeAt(2) & 0xFF) <<  8 |
      (s.charCodeAt(3) & 0xFF) <<  0
    );
  }

  function _hb_untag(tag) {
    return [
      String.fromCharCode((tag >> 24) & 0xFF),
      String.fromCharCode((tag >> 16) & 0xFF),
      String.fromCharCode((tag >>  8) & 0xFF),
      String.fromCharCode((tag >>  0) & 0xFF)
    ].join('');
  }

  function _buffer_flag(s) {
    if (s == "BOT") { return 0x1; }
    if (s == "EOT") { return 0x2; }
    if (s == "PRESERVE_DEFAULT_IGNORABLES") { return 0x4; }
    if (s == "REMOVE_DEFAULT_IGNORABLES") { return 0x8; }
    if (s == "DO_NOT_INSERT_DOTTED_CIRCLE") { return 0x10; }
    if (s == "PRODUCE_UNSAFE_TO_CONCAT") { return 0x40; }
    return 0x0;
  }

  /**
  * Create an object representing a Harfbuzz blob.
  * @param {string} blob A blob of binary data (usually the contents of a font file).
  **/
  function createBlob(blob) {
    var blobPtr = exports.malloc(blob.byteLength);
    heapu8.set(new Uint8Array(blob), blobPtr);
    var ptr = exports.hb_blob_create(blobPtr, blob.byteLength, HB_MEMORY_MODE_WRITABLE, blobPtr, exports.free_ptr());
    return {
      ptr: ptr,
      /**
      * Free the object.
      */
      destroy: function () { exports.hb_blob_destroy(ptr); }
    };
  }

  /**
   * Return the typed array of HarfBuzz set contents.
   * @template {typeof Uint8Array | typeof Uint32Array | typeof Int32Array | typeof Float32Array} T
   * @param {number} setPtr Pointer of set
   * @param {T} arrayClass Typed array class
   * @returns {InstanceType<T>} Typed array instance
   */
  function typedArrayFromSet(setPtr, arrayClass) {
    let heap = heapu8;
    if (arrayClass === Uint32Array) {
      heap = heapu32;
    } else if (arrayClass === Int32Array) {
      heap = heapi32;
    } else if (arrayClass === Float32Array) {
      heap = heapf32;
    }
    const bytesPerElment = arrayClass.BYTES_PER_ELEMENT;
    const setCount = exports.hb_set_get_population(setPtr);
    const arrayPtr = exports.malloc(
      setCount * bytesPerElment,
    );
    const arrayOffset = arrayPtr / bytesPerElment;
    const array = heap.subarray(
      arrayOffset,
      arrayOffset + setCount,
    );
    heap.set(array, arrayOffset);
    exports.hb_set_next_many(
      setPtr,
      HB_SET_VALUE_INVALID,
      arrayPtr,
      setCount,
    );
    return array;
  }

  /**
  * Create an object representing a Harfbuzz face.
  * @param {object} blob An object returned from `createBlob`.
  * @param {number} index The index of the font in the blob. (0 for most files,
  *  or a 0-indexed font number if the `blob` came form a TTC/OTC file.)
  **/
  function createFace(blob, index) {
    var ptr = exports.hb_face_create(blob.ptr, index);
    const upem = exports.hb_face_get_upem(ptr);
    return {
      ptr: ptr,
      upem,
      /**
       * Return the binary contents of an OpenType table.
       * @param {string} table Table name
       */
      reference_table: function(table) {
        var blob = exports.hb_face_reference_table(ptr, hb_tag(table));
        var length = exports.hb_blob_get_length(blob);
        if (!length) { return; }
        var blobptr = exports.hb_blob_get_data(blob, null);
        var table_string = heapu8.subarray(blobptr, blobptr+length);
        return table_string;
      },
      /**
       * Return variation axis infos
       */
      getAxisInfos: function() {
        var axis = exports.malloc(64 * 32);
        var c = exports.malloc(4);
        heapu32[c / 4] = 64;
        exports.hb_ot_var_get_axis_infos(ptr, 0, c, axis);
        var result = {};
        Array.from({ length: heapu32[c / 4] }).forEach(function (_, i) {
          result[_hb_untag(heapu32[axis / 4 + i * 8 + 1])] = {
            min: heapf32[axis / 4 + i * 8 + 4],
            default: heapf32[axis / 4 + i * 8 + 5],
            max: heapf32[axis / 4 + i * 8 + 6]
          };
        });
        exports.free(c);
        exports.free(axis);
        return result;
      },
      /**
       * Return unicodes the face supports
       */
      collectUnicodes: function() {
        var unicodeSetPtr = exports.hb_set_create();
        exports.hb_face_collect_unicodes(ptr, unicodeSetPtr);
        var result = typedArrayFromSet(unicodeSetPtr, Uint32Array);
        exports.hb_set_destroy(unicodeSetPtr);
        return result;
      },
      /**
       * Free the object.
       */
      destroy: function () {
        exports.hb_face_destroy(ptr);
      },
    };
  }

  var pathBufferSize = 65536; // should be enough for most glyphs
  var pathBuffer = exports.malloc(pathBufferSize); // permanently allocated

  var nameBufferSize = 256; // should be enough for most glyphs
  var nameBuffer = exports.malloc(nameBufferSize); // permanently allocated

  /**
  * Create an object representing a Harfbuzz font.
  * @param {object} blob An object returned from `createFace`.
  **/
  function createFont(face) {
    var ptr = exports.hb_font_create(face.ptr);

    /**
    * Return a glyph as an SVG path string.
    * @param {number} glyphId ID of the requested glyph in the font.
    **/
    function glyphToPath(glyphId) {
      var svgLength = exports.hbjs_glyph_svg(ptr, glyphId, pathBuffer, pathBufferSize);
      return svgLength > 0 ? utf8Decoder.decode(heapu8.subarray(pathBuffer, pathBuffer + svgLength)) : "";
    }

    /**
     * Return glyph name.
     * @param {number} glyphId ID of the requested glyph in the font.
     **/
    function glyphName(glyphId) {
      exports.hb_font_glyph_to_string(
        ptr,
        glyphId,
        nameBuffer,
        nameBufferSize
      );
      var array = heapu8.subarray(nameBuffer, nameBuffer + nameBufferSize);
      return utf8Decoder.decode(array.slice(0, array.indexOf(0)));
    }

    return {
      ptr: ptr,
      glyphName: glyphName,
      glyphToPath: glyphToPath,
      drawGlyph(glyphId, ctx) {
        hbjs.ctx = ctx;
        exports.hbjs_glyph_draw(ptr, glyphId);
      },
      getStyle(styleTag) {
        return exports.hb_style_get_value(ptr, hb_tag(styleTag));
      },
      /**
      * Return a glyph as a JSON path string
      * based on format described on https://svgwg.org/specs/paths/#InterfaceSVGPathSegment
      * @param {number} glyphId ID of the requested glyph in the font.
      **/
      glyphToJson: function (glyphId) {
        var path = glyphToPath(glyphId);
        return path.replace(/([MLQCZ])/g, '|$1 ').split('|').filter(function (x) { return x.length; }).map(function (x) {
          var row = x.split(/[ ,]/g);
          return { type: row[0], values: row.slice(1).filter(function (x) { return x.length; }).map(function (x) { return +x; }) };
        });
      },
      /**
      * Set the font's scale factor, affecting the position values returned from
      * shaping.
      * @param {number} xScale Units to scale in the X dimension.
      * @param {number} yScale Units to scale in the Y dimension.
      **/
      setScale: function (xScale, yScale) {
        exports.hb_font_set_scale(ptr, xScale, yScale);
      },
      /**
       * Set the font's variations.
       * @param {object} variations Dictionary of variations to set
       **/
      setVariations: function (variations) {
        var entries = Object.entries(variations);
        var vars = exports.malloc(8 * entries.length);
        entries.forEach(function (entry, i) {
          heapu32[vars / 4 + i * 2 + 0] = hb_tag(entry[0]);
          heapf32[vars / 4 + i * 2 + 1] = entry[1];
        });
        exports.hb_font_set_variations(ptr, vars, entries.length);
        exports.free(vars);
      },
      /**
      * Gets the extents for the font, given a direction
      * @param {"ltr"|"rtl"|"ttb"|"btt"} dir
      */
      getMetrics: function (dir) {
        const extentsPtr = exports.malloc(4); // i32 * 12
        const extentsOffset = extentsPtr / 4;
        let ascender, descender, lineGap;

        if (dir === 'ltr' || dir === 'rtl') {
          exports.hb_ot_metrics_get_position_with_fallback(ptr, hb_tag('hasc'), extentsPtr);
          ascender = heapi32[extentsOffset];
          exports.hb_ot_metrics_get_position_with_fallback(ptr, hb_tag('hdsc'), extentsPtr);
          descender = heapi32[extentsOffset];
          exports.hb_ot_metrics_get_position_with_fallback(ptr, hb_tag('hlgp'), extentsPtr);
          lineGap = heapi32[extentsOffset];
        } else {
          exports.hb_ot_metrics_get_position_with_fallback(ptr, hb_tag('vasc'), extentsPtr);
          ascender = heapi32[extentsOffset];
          exports.hb_ot_metrics_get_position_with_fallback(ptr, hb_tag('vdsc'), extentsPtr);
          descender = heapi32[extentsOffset];
          exports.hb_ot_metrics_get_position_with_fallback(ptr, hb_tag('vlgp'), extentsPtr);
          lineGap = heapi32[extentsOffset];
        }

        exports.hb_ot_metrics_get_position_with_fallback(ptr, hb_tag('spyo'), extentsPtr);
        const superscript = heapi32[extentsOffset];
        exports.hb_ot_metrics_get_position_with_fallback(ptr, hb_tag('sbyo'), extentsPtr);
        const subscript = heapi32[extentsOffset];
        exports.hb_ot_metrics_get_position_with_fallback(ptr, hb_tag('xhgt'), extentsPtr);
        const xHeight = heapi32[extentsOffset];

        exports.free(extentsPtr);

        return {ascender, descender, lineGap, superscript, subscript, xHeight};
      },
      /**
      * Free the object.
      */
      destroy: function () { exports.hb_font_destroy(ptr); }
    };
  }

  /**
  * Use when you know the input range should be ASCII.
  * Faster than encoding to UTF-8
  **/
  function createAsciiString(text) {
    var ptr = exports.malloc(text.length + 1);
    for (let i = 0; i < text.length; ++i) {
      const char = text.charCodeAt(i);
      if (char > 127) throw new Error('Expected ASCII text');
      heapu8[ptr + i] = char;
    }
    heapu8[ptr + text.length] = 0;
    return {
      ptr: ptr,
      length: text.length,
      free: function () { exports.free(ptr); }
    };
  }

  function createJsString(text) {
    const ptr = exports.malloc(text.length * 2);
    const words = new Uint16Array(exports.memory.buffer, ptr, text.length);
    for (let i = 0; i < words.length; ++i) words[i] = text.charCodeAt(i);
    return {
      ptr: ptr,
      length: words.length,
      free: function () { exports.free(ptr); }
    };
  }

  /**
  * Create an object representing a Harfbuzz buffer.
  **/
  function createBuffer() {
    var ptr = exports.hb_buffer_create();
    return {
      ptr: ptr,
      /**
      * Add text to the buffer.
      * @param {string} text Text to be added to the buffer.
      **/
      addText: function (text) {
        const str = createJsString(text);
        exports.hb_buffer_add_utf16(ptr, str.ptr, str.length, 0, str.length);
        str.free();
      },
      /**
       * @param {number} paragraphPtr pointer to start of utf-16 paragraph
       * @param {number} paragraphLength size of utf-16 paragraph in units of 16 bits
       * @param {number} offset offset into the paragraph to add
       * @param {number} size of run in the paragraph to add
       */
      addUtf16(paragraphPtr, paragraphLength, offset, length) {
        exports.hb_buffer_add_utf16(ptr, paragraphPtr, paragraphLength, offset, length);
      },
      /**
      * Set buffer script, language and direction.
      *
      * This needs to be done before shaping.
      **/
      guessSegmentProperties: function () {
        return exports.hb_buffer_guess_segment_properties(ptr);
      },
      /**
      * Set buffer direction explicitly.
      * @param {string} direction: One of "ltr", "rtl", "ttb" or "btt"
      */
      setDirection: function (dir) {
        exports.hb_buffer_set_direction(ptr, {
          ltr: 4,
          rtl: 5,
          ttb: 6,
          btt: 7
        }[dir] || 0);
      },
      /**
      * Set buffer flags explicitly.
      * @param {string[]} flags: A list of strings which may be either:
      * "BOT"
      * "EOT"
      * "PRESERVE_DEFAULT_IGNORABLES"
      * "REMOVE_DEFAULT_IGNORABLES"
      * "DO_NOT_INSERT_DOTTED_CIRCLE"
      * "PRODUCE_UNSAFE_TO_CONCAT"
      */
      setFlags: function (flags) {
        var flagValue = 0
        flags.forEach(function (s) {
          flagValue |= _buffer_flag(s);
        })

        exports.hb_buffer_set_flags(ptr,flagValue);
      },
      /**
      * Set buffer language explicitly.
      * @param {string} language: The buffer language
      */
      setLanguage: function (language) {
        var str = createAsciiString(language);
        exports.hb_buffer_set_language(ptr, exports.hb_language_from_string(str.ptr,-1));
        str.free();
      },
      /**
      * Set buffer script explicitly.
      * @param {string} script: The buffer script
      */
      setScript: function (script) {
        var str = createAsciiString(script);
        exports.hb_buffer_set_script(ptr, exports.hb_script_from_string(str.ptr,-1));
        str.free();
      },

      /**
      * Set the Harfbuzz clustering level.
      *
      * Affects the cluster values returned from shaping.
      * @param {number} level: Clustering level. See the Harfbuzz manual chapter
      * on Clusters.
      **/
      setClusterLevel: function (level) {
        exports.hb_buffer_set_cluster_level(ptr, level)
      },
      /**
      * Return the buffer contents as a JSON object.
      *
      * After shaping, this function will return an array of glyph information
      * objects. Each object will have the following attributes:
      *
      *   - g: The glyph ID
      *   - cl: The cluster ID
      *   - ax: Advance width (width to advance after this glyph is painted)
      *   - ay: Advance height (height to advance after this glyph is painted)
      *   - dx: X displacement (adjustment in X dimension when painting this glyph)
      *   - dy: Y displacement (adjustment in Y dimension when painting this glyph)
      *   - flags: Glyph flags like `HB_GLYPH_FLAG_UNSAFE_TO_BREAK` (0x1)
      **/
      json: function () {
        var length = exports.hb_buffer_get_length(ptr);
        var result = [];
        var infosPtr = exports.hb_buffer_get_glyph_infos(ptr, 0);
        var infosPtr32 = infosPtr / 4;
        var positionsPtr32 = exports.hb_buffer_get_glyph_positions(ptr, 0) / 4;
        var infos = heapu32.subarray(infosPtr32, infosPtr32 + 5 * length);
        var positions = heapi32.subarray(positionsPtr32, positionsPtr32 + 5 * length);
        for (var i = 0; i < length; ++i) {
          result.push({
            g: infos[i * 5 + 0],
            cl: infos[i * 5 + 2],
            ax: positions[i * 5 + 0],
            ay: positions[i * 5 + 1],
            dx: positions[i * 5 + 2],
            dy: positions[i * 5 + 3],
            flags: exports.hb_glyph_info_get_glyph_flags(infosPtr + i * 20)
          });
        }
        return result;
      },
      /**
      * Free the object.
      */
      destroy: function () { exports.hb_buffer_destroy(ptr); }
    };
  }

  /**
  * Shape a buffer with a given font.
  *
  * This returns nothing, but modifies the buffer.
  *
  * @param {object} font: A font returned from `createFont`
  * @param {object} buffer: A buffer returned from `createBuffer` and suitably
  *   prepared.
  * @param {object} features: (Currently unused).
  */
  function shape(font, buffer, features) {
    exports.hb_shape(font.ptr, buffer.ptr, 0, 0);
  }

  /**
  * Shape a buffer with a given font, returning a JSON trace of the shaping process.
  *
  * This function supports "partial shaping", where the shaping process is
  * terminated after a given lookup ID is reached. If the user requests the function
  * to terminate shaping after an ID in the GSUB phase, GPOS table lookups will be
  * processed as normal.
  *
  * @param {object} font: A font returned from `createFont`
  * @param {object} buffer: A buffer returned from `createBuffer` and suitably
  *   prepared.
  * @param {object} features: A dictionary of OpenType features to apply.
  * @param {number} stop_at: A lookup ID at which to terminate shaping.
  * @param {number} stop_phase: Either 0 (don't terminate shaping), 1 (`stop_at`
      refers to a lookup ID in the GSUB table), 2 (`stop_at` refers to a lookup
      ID in the GPOS table).
  */

  function shapeWithTrace(font, buffer, features, stop_at, stop_phase) {
    var bufLen = 1024 * 1024;
    var traceBuffer = exports.malloc(bufLen);
    var featurestr = createAsciiString(features);
    var traceLen = exports.hbjs_shape_with_trace(font.ptr, buffer.ptr, featurestr.ptr, stop_at, stop_phase, traceBuffer, bufLen);
    featurestr.free();
    var trace = utf8Decoder.decode(heapu8.subarray(traceBuffer, traceBuffer + traceLen - 1));
    exports.free(traceBuffer);
    return JSON.parse(trace);
  }

  function allocateUint16Array(size) {
    const ptr = exports.malloc(size * 2);
    const array = new Uint16Array(exports.memory.buffer, ptr, size);
    return {array, destroy: function () { exports.free(ptr); }};
  }

  return {
    allocateUint16Array: allocateUint16Array,
    createBlob: createBlob,
    createFace: createFace,
    createFont: createFont,
    createBuffer: createBuffer,
    shape: shape,
    shapeWithTrace: shapeWithTrace
  };
};


hbjs.setCtx = function (_ctx) {
  hbjs.ctx = _ctx;
};

hbjs.env = {
  hb_ot_layout_get_size_params() {
    return 0;
  },
  hbjs_glyph_draw_move_to(x, y) {
    hbjs.ctx.moveTo(x, y);
  },
  hbjs_glyph_draw_line_to(x, y) {
    hbjs.ctx.lineTo(x, y);
  },
  hbjs_glyph_draw_quadratic_to(control_x, control_y, to_x, to_y) {
    hbjs.ctx.quadraticCurveTo(control_x, control_y, to_x, to_y);
  },
  hbjs_glyph_draw_cubic_to(control1_x, control1_y, control2_x, control2_y) {
    hbjs.ctx.bezierCurveTo(control1_x, control1_y, control2_x, control2_y);
  },
  hbjs_glyph_draw_close_path() {
    hbjs.ctx.closePath();
  }
}

// Should be replaced with something more reliable
try { module.exports = hbjs; } catch(e) {}
