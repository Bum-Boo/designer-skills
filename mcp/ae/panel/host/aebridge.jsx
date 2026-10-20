var AEB = AEB || {};
(function () {
  AEB.hostVersion = '0.2.0';

  function quote(value) {
    return (
      '"' +
      String(value).replace(/[\u0000-\u001f\u2028\u2029\\"]/g, function (character) {
        var escapes = {
          '"': '\\"',
          '\\': '\\\\',
          '\b': '\\b',
          '\f': '\\f',
          '\n': '\\n',
          '\r': '\\r',
          '\t': '\\t'
        };
        var hex;
        if (escapes[character]) return escapes[character];
        hex = character.charCodeAt(0).toString(16);
        while (hex.length < 4) hex = '0' + hex;
        return '\\u' + hex;
      }) +
      '"'
    );
  }

  function encode(value) {
    var parts, key, i;
    if (value === null || typeof value === 'undefined') return 'null';
    if (typeof value === 'string') return quote(value);
    if (typeof value === 'number') return isFinite(value) ? String(value) : 'null';
    if (typeof value === 'boolean') return String(value);
    parts = [];
    if (value instanceof Array) {
      for (i = 0; i < value.length; i++) parts.push(encode(value[i]));
      return '[' + parts.join(',') + ']';
    }
    for (key in value) {
      if (value.hasOwnProperty(key)) parts.push(quote(key) + ':' + encode(value[key]));
    }
    return '{' + parts.join(',') + '}';
  }

  function read(path) {
    var file = new File(path),
      source;
    file.encoding = 'UTF-8';
    if (!file.open('r')) throw new Error('Cannot open arguments: ' + path);
    source = file.read();
    file.close();
    return eval('(' + source + ')');
  }

  function write(path, value) {
    var file = new File(path);
    file.encoding = 'UTF-8';
    if (!file.open('w')) throw new Error('Cannot open result: ' + path);
    file.write(encode(value));
    file.close();
  }

  function fail(code, message, details) {
    return { ok: false, error: { code: code, message: String(message), details: details || {} } };
  }

  function frame(time, comp) {
    return Number((time * comp.frameRate).toFixed(3));
  }
  function seconds(value, comp) {
    return value / comp.frameRate;
  }
  function timestamp() {
    var date = new Date();
    function two(value) {
      return value < 10 ? '0' + value : String(value);
    }
    return (
      date.getUTCFullYear() +
      '-' +
      two(date.getUTCMonth() + 1) +
      '-' +
      two(date.getUTCDate()) +
      'T' +
      two(date.getUTCHours()) +
      ':' +
      two(date.getUTCMinutes()) +
      ':' +
      two(date.getUTCSeconds()) +
      'Z'
    );
  }

  function compById(id) {
    var item;
    if (typeof id === 'undefined' || id === null) item = app.project.activeItem;
    else item = app.project.itemByID(id);
    if (!(item instanceof CompItem)) throw new Error('COMP_NOT_FOUND');
    return item;
  }

  function layerById(id) {
    var layer = app.project.layerByID(id);
    if (!layer) throw new Error('LAYER_MISSING');
    return layer;
  }

  function compInfo(comp) {
    var folder = '';
    try {
      if (comp.parentFolder) folder = comp.parentFolder.name;
    } catch (ignored) {}
    return {
      id: comp.id,
      name: comp.name,
      folder: folder,
      width: comp.width,
      height: comp.height,
      pixelAspect: comp.pixelAspect,
      frameRate: comp.frameRate,
      durationFrames: frame(comp.duration, comp),
      layers: comp.numLayers
    };
  }

  function status() {
    var project = app.project,
      active = project.activeItem,
      current = null;
    if (active instanceof CompItem)
      current = { id: active.id, name: active.name, frame: frame(active.time, active) };
    return {
      ok: true,
      version: app.version,
      hostVersion: AEB.hostVersion,
      project: {
        path: project.file ? project.file.fsName.replace(/\\/g, '/') : '',
        dirty: Boolean(project.dirty)
      },
      activeComp: current
    };
  }

  function listComps() {
    var comps = [],
      i,
      item;
    for (i = 1; i <= app.project.numItems; i++) {
      item = app.project.item(i);
      if (item instanceof CompItem) comps.push(compInfo(item));
    }
    return { ok: true, comps: comps };
  }

  var blendNames = [
    'NORMAL',
    'DISSOLVE',
    'DANCING_DISSOLVE',
    'DARKEN',
    'MULTIPLY',
    'COLOR_BURN',
    'CLASSIC_COLOR_BURN',
    'LINEAR_BURN',
    'DARKER_COLOR',
    'ADD',
    'LIGHTEN',
    'SCREEN',
    'COLOR_DODGE',
    'CLASSIC_COLOR_DODGE',
    'LINEAR_DODGE',
    'LIGHTER_COLOR',
    'OVERLAY',
    'SOFT_LIGHT',
    'HARD_LIGHT',
    'LINEAR_LIGHT',
    'VIVID_LIGHT',
    'PIN_LIGHT',
    'HARD_MIX',
    'DIFFERENCE',
    'CLASSIC_DIFFERENCE',
    'EXCLUSION',
    'HUE',
    'SATURATION',
    'COLOR',
    'LUMINOSITY',
    'STENCIL_ALPHA',
    'STENCIL_LUMA',
    'SILHOUETTE_ALPHA',
    'SILHOUETTE_LUMA',
    'ALPHA_ADD',
    'LUMINESCENT_PREMUL'
  ];

  function blendName(value) {
    var i, name;
    for (i = 0; i < blendNames.length; i++) {
      name = blendNames[i];
      try {
        if (BlendingMode[name] === value) return name;
      } catch (ignored) {}
    }
    return 'NORMAL';
  }

  function layerType(layer) {
    try {
      if (layer instanceof TextLayer) return 'text';
      if (layer instanceof ShapeLayer) return 'shape';
      if (layer instanceof CameraLayer) return 'camera';
      if (layer instanceof LightLayer) return 'light';
      if (layer instanceof AVLayer) {
        if (layer.nullLayer) return 'null';
        if (layer.adjustmentLayer) return 'adjustment';
        if (layer.source instanceof CompItem) return 'precomp';
        if (layer.source && layer.source.mainSource instanceof SolidSource) return 'solid';
      }
    } catch (ignored) {}
    return 'av';
  }

  function plain(value) {
    var result, i;
    if (value instanceof Array) {
      result = [];
      for (i = 0; i < value.length; i++) result.push(plain(value[i]));
      return result;
    }
    if (
      typeof value === 'number' ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      value === null
    )
      return value;
    return null;
  }

  function interpolation(value) {
    if (value === KeyframeInterpolationType.BEZIER) return 'bezier';
    if (value === KeyframeInterpolationType.HOLD) return 'hold';
    return 'linear';
  }

  function temporalEase(prop, key, incoming) {
    var source = incoming ? prop.keyInTemporalEase(key) : prop.keyOutTemporalEase(key),
      result = [],
      i;
    for (i = 0; i < source.length; i++)
      result.push({ speed: source[i].speed, influence: source[i].influence });
    return result;
  }

  function spatialInfo(prop, key) {
    var input = prop.keyInSpatialTangent(key),
      output = prop.keyOutSpatialTangent(key),
      i,
      nonzero = false;
    for (i = 0; i < input.length; i++) if (input[i] !== 0 || output[i] !== 0) nonzero = true;
    if (!nonzero) return null;
    return {
      inTan: plain(input),
      outTan: plain(output),
      auto: prop.keySpatialAutoBezier(key),
      continuous: prop.keySpatialContinuous(key),
      roving: prop.keyRoving(key)
    };
  }

  function propertyValue(prop, comp) {
    var result = {},
      keys = [],
      i,
      input,
      output,
      key,
      spatial;
    if (prop.numKeys > 0) {
      for (i = 1; i <= prop.numKeys; i++) {
        input = interpolation(prop.keyInInterpolationType(i));
        output = interpolation(prop.keyOutInterpolationType(i));
        key = {
          f: frame(prop.keyTime(i), comp),
          v: plain(prop.keyValue(i)),
          interp: input === output ? input : [input, output]
        };
        if (input === 'bezier') key.easeIn = temporalEase(prop, i, true);
        if (output === 'bezier') key.easeOut = temporalEase(prop, i, false);
        if (
          prop.propertyValueType === PropertyValueType.TwoD_SPATIAL ||
          prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL
        ) {
          spatial = spatialInfo(prop, i);
          if (spatial) key.spatial = spatial;
        }
        keys.push(key);
      }
      result.keys = keys;
    } else result.value = plain(prop.valueAtTime(comp.time, true));
    try {
      if (prop.canSetExpression && prop.expression) {
        result.expression = prop.expression;
        result.expressionEnabled = Boolean(prop.expressionEnabled);
      }
    } catch (ignored) {}
    return result;
  }

  function transformProperties(layer, comp) {
    var group = layer.property('ADBE Transform Group'),
      result = {},
      names,
      i,
      property;
    if (!group) return result;
    names = [
      ['anchorPoint', 'ADBE Anchor Point'],
      ['position', 'ADBE Position'],
      ['scale', 'ADBE Scale'],
      ['rotation', 'ADBE Rotate Z'],
      ['rotationX', 'ADBE Rotate X'],
      ['rotationY', 'ADBE Rotate Y'],
      ['orientation', 'ADBE Orientation'],
      ['opacity', 'ADBE Opacity']
    ];
    try {
      property = group.property('ADBE Position');
      if (property && property.dimensionsSeparated) {
        names[1] = ['positionX', 'ADBE Position_0'];
        names.push(['positionY', 'ADBE Position_1']);
        if (layer.threeDLayer) names.push(['positionZ', 'ADBE Position_2']);
      }
    } catch (ignored) {}
    for (i = 0; i < names.length; i++) {
      property = group.property(names[i][1]);
      if (property) {
        if (names[i][0] === 'rotation' && layer.threeDLayer)
          result.rotationZ = propertyValue(property, comp);
        else result[names[i][0]] = propertyValue(property, comp);
      }
    }
    return result;
  }

  function textDocument(document) {
    var result = {
      text: document.text,
      font: document.font,
      fontSize: document.fontSize,
      applyFill: Boolean(document.applyFill),
      applyStroke: Boolean(document.applyStroke),
      tracking: document.tracking,
      leading: document.leading,
      autoLeading: Boolean(document.autoLeading)
    };
    if (result.applyFill) result.fillColor = plain(document.fillColor);
    if (result.applyStroke) {
      result.strokeColor = plain(document.strokeColor);
      result.strokeWidth = document.strokeWidth;
    }
    try {
      if (document.justification === ParagraphJustification.CENTER_JUSTIFY)
        result.justification = 'CENTER';
      else if (document.justification === ParagraphJustification.RIGHT_JUSTIFY)
        result.justification = 'RIGHT';
      else result.justification = 'LEFT';
    } catch (ignored) {
      result.justification = 'LEFT';
    }
    return result;
  }

  function textState(layer, comp) {
    var group = layer.property('ADBE Text Properties'),
      prop,
      keys = [],
      i;
    if (!group) return null;
    prop = group.property('ADBE Text Document');
    if (!prop) return null;
    if (prop.numKeys === 0) return { doc: textDocument(prop.value) };
    for (i = 1; i <= prop.numKeys; i++) {
      keys.push({
        f: frame(prop.keyTime(i), comp),
        v: textDocument(prop.keyValue(i)),
        interp: 'hold'
      });
    }
    return { keys: keys };
  }

  function effectsState(layer, comp) {
    var group = layer.property('ADBE Effect Parade'),
      effects = [],
      effect,
      item,
      params,
      i,
      j,
      state;
    if (!group) return effects;
    for (i = 1; i <= group.numProperties; i++) {
      effect = group.property(i);
      params = {};
      for (j = 1; j <= effect.numProperties; j++) {
        item = effect.property(j);
        try {
          if (
            item.propertyType === PropertyType.PROPERTY &&
            item.propertyValueType !== PropertyValueType.NO_VALUE &&
            item.propertyValueType !== PropertyValueType.CUSTOM_VALUE
          ) {
            state = propertyValue(item, comp);
            params[item.matchName] = {
              name: item.name,
              value: typeof state.value === 'undefined' || state.expression ? state : state.value
            };
          }
        } catch (ignored) {}
      }
      effects.push({
        index: i,
        matchName: effect.matchName,
        name: effect.name,
        enabled: Boolean(effect.enabled),
        params: params
      });
    }
    return effects;
  }

  function unsupported(layer) {
    var result = [],
      textGroup;
    try {
      if (layer.property('ADBE Mask Parade').numProperties) result.push('masks');
    } catch (ignored) {}
    try {
      if (layer.property('ADBE Root Vectors Group').numProperties) result.push('shapeContents');
    } catch (ignored2) {}
    try {
      if (layer.property('ADBE Layer Styles').numProperties) result.push('layerStyles');
    } catch (ignored3) {}
    try {
      textGroup = layer.property('ADBE Text Properties');
      if (textGroup && textGroup.property('ADBE Text Animators').numProperties)
        result.push('textAnimators');
    } catch (ignored4) {}
    try {
      if (layer.hasAudio) result.push('audio');
    } catch (ignored5) {}
    try {
      if (layer.property('ADBE Marker').numKeys) result.push('markers');
    } catch (ignored6) {}
    return result;
  }

  function exportLayer(layer, comp) {
    var kind = layerType(layer),
      sourceId = null,
      sourceName = null,
      state,
      remap;
    if (kind === 'precomp' || kind === 'av') {
      try {
        if (layer.source) {
          sourceId = layer.source.id;
          sourceName = layer.source.name;
        }
      } catch (ignored) {}
    }
    state = {
      id: layer.id,
      index: layer.index,
      name: layer.name,
      type: kind,
      sourceId: sourceId,
      sourceName: sourceName,
      attr: {
        enabled: Boolean(layer.enabled),
        locked: Boolean(layer.locked),
        shy: Boolean(layer.shy),
        solo: Boolean(layer.solo),
        inPoint: frame(layer.inPoint, comp),
        outPoint: frame(layer.outPoint, comp),
        startTime: frame(layer.startTime, comp),
        stretch: layer.stretch,
        parentId: layer.parent ? layer.parent.id : null,
        threeD: Boolean(layer.threeDLayer),
        blendingMode: blendName(layer.blendingMode),
        label: layer.label,
        comment: layer.comment
      },
      transform: transformProperties(layer, comp),
      effects: effectsState(layer, comp),
      unsupported: unsupported(layer)
    };
    try {
      if (layer.canSetTimeRemapEnabled && layer.timeRemapEnabled) {
        remap = layer.property('ADBE Time Remapping');
        if (remap) state.timeRemap = propertyValue(remap, comp);
      }
    } catch (ignored2) {}
    if (kind === 'text') state.text = textState(layer, comp);
    return state;
  }

  function exportComp(args) {
    var comp = compById(args.compId),
      layers = [],
      i,
      layer,
      include = true,
      j;
    for (i = 1; i <= comp.numLayers; i++) {
      layer = comp.layer(i);
      include = !args.layerIds || args.layerIds.length === 0;
      if (!include)
        for (j = 0; j < args.layerIds.length; j++)
          if (args.layerIds[j] === layer.id) include = true;
      if (include) layers.push(exportLayer(layer, comp));
    }
    return {
      ok: true,
      state: {
        aebridge: 'comp-state/0.1',
        project: {
          path: app.project.file ? app.project.file.fsName.replace(/\\/g, '/') : '',
          key: ''
        },
        comp: {
          id: comp.id,
          name: comp.name,
          width: comp.width,
          height: comp.height,
          pixelAspect: comp.pixelAspect,
          frameRate: comp.frameRate,
          durationFrames: frame(comp.duration, comp)
        },
        exportedAt: timestamp(),
        layers: layers
      }
    };
  }

  function deepEqual(left, right) {
    var i,
      key,
      countLeft = 0,
      countRight = 0;
    if (typeof left === 'number' && typeof right === 'number')
      return Math.abs(left - right) <= 0.001;
    if (left === right) return true;
    if (left === null || right === null || typeof left !== typeof right) return false;
    if (left instanceof Array && right instanceof Array) {
      if (left.length !== right.length) return false;
      for (i = 0; i < left.length; i++) if (!deepEqual(left[i], right[i])) return false;
      return true;
    }
    if (typeof left === 'object' && typeof right === 'object') {
      for (key in left)
        if (left.hasOwnProperty(key)) {
          countLeft++;
          if (!right.hasOwnProperty(key) || !deepEqual(left[key], right[key])) return false;
        }
      for (key in right) if (right.hasOwnProperty(key)) countRight++;
      return countLeft === countRight;
    }
    return false;
  }

  function transformProperty(layer, name) {
    var group = layer.property('ADBE Transform Group'),
      matches = {
        anchorPoint: 'ADBE Anchor Point',
        position: 'ADBE Position',
        positionX: 'ADBE Position_0',
        positionY: 'ADBE Position_1',
        positionZ: 'ADBE Position_2',
        scale: 'ADBE Scale',
        rotation: 'ADBE Rotate Z',
        rotationZ: 'ADBE Rotate Z',
        rotationX: 'ADBE Rotate X',
        rotationY: 'ADBE Rotate Y',
        orientation: 'ADBE Orientation',
        opacity: 'ADBE Opacity'
      };
    return group ? group.property(matches[name]) : null;
  }

  function effectByPath(layer, index, matchName) {
    var group = layer.property('ADBE Effect Parade'),
      effect;
    if (!group) return null;
    effect = group.property(index);
    return effect && effect.matchName === matchName ? effect : null;
  }

  function paramByName(effect, matchName) {
    var i, prop;
    for (i = 1; i <= effect.numProperties; i++) {
      prop = effect.property(i);
      if (prop.matchName === matchName) return prop;
    }
    return null;
  }

  function valueAtPath(comp, path) {
    var match = /^L(\d+)\.(.+)$/.exec(path),
      layer,
      tail,
      effectMatch,
      effect,
      property,
      text;
    if (!match) return null;
    layer = layerById(Number(match[1]));
    tail = match[2];
    if (tail === 'name') return layer.name;
    if (tail.indexOf('attr.') === 0) {
      tail = tail.substr(5);
      if (tail === 'inPoint' || tail === 'outPoint' || tail === 'startTime')
        return frame(layer[tail], comp);
      if (tail === 'parentId') return layer.parent ? layer.parent.id : null;
      if (tail === 'threeD') return Boolean(layer.threeDLayer);
      if (tail === 'blendingMode') return blendName(layer.blendingMode);
      return layer[tail];
    }
    if (tail.indexOf('transform.') === 0) {
      property = transformProperty(layer, tail.substr(10));
      return property ? propertyValue(property, comp) : null;
    }
    if (tail === 'timeRemap') {
      property = layer.property('ADBE Time Remapping');
      return property ? propertyValue(property, comp) : null;
    }
    if (tail.indexOf('text.') === 0) {
      text = textState(layer, comp);
      if (!text) return null;
      if (tail === 'text.keys') return text.keys || null;
      return text.doc ? text.doc[tail.substr(9)] : null;
    }
    effectMatch = /^fx\[(\d+):([^\]]+)\]\.(enabled|params\.(.+))$/.exec(tail);
    if (effectMatch) {
      effect = effectByPath(layer, Number(effectMatch[1]), effectMatch[2]);
      if (!effect) return null;
      if (effectMatch[3] === 'enabled') return Boolean(effect.enabled);
      property = paramByName(effect, effectMatch[4]);
      if (!property) return null;
      var state = propertyValue(property, comp);
      return {
        name: property.name,
        value: typeof state.value === 'undefined' || state.expression ? state : state.value
      };
    }
    return null;
  }

  function interpolationType(name) {
    if (name === 'bezier') return KeyframeInterpolationType.BEZIER;
    if (name === 'hold') return KeyframeInterpolationType.HOLD;
    return KeyframeInterpolationType.LINEAR;
  }

  function easeValues(items, count) {
    var result = [],
      i,
      influence;
    for (i = 0; i < count; i++) {
      if (!items || !items[i]) {
        result.push(new KeyframeEase(0, 33.333));
        continue;
      }
      influence = Math.min(100, Math.max(0.1, items[i].influence));
      result.push(new KeyframeEase(items[i].speed, influence));
    }
    return result;
  }

  function writeProperty(prop, value, comp) {
    var i, key, inName, outName, easeCount, wantedExpression;
    if (value.keys) {
      for (i = prop.numKeys; i >= 1; i--) prop.removeKey(i);
      for (i = 0; i < value.keys.length; i++) {
        key = value.keys[i];
        prop.setValueAtTime(seconds(key.f, comp), key.v);
        inName = key.interp instanceof Array ? key.interp[0] : key.interp;
        outName = key.interp instanceof Array ? key.interp[1] : key.interp;
        // Ease first: setting temporal ease can switch both sides to bezier.
        if (inName === 'bezier' || outName === 'bezier') {
          easeCount = (key.easeIn && key.easeIn.length) || (key.easeOut && key.easeOut.length) || 1;
          prop.setTemporalEaseAtKey(
            i + 1,
            easeValues(key.easeIn, easeCount),
            easeValues(key.easeOut, easeCount)
          );
        }
        prop.setInterpolationTypeAtKey(
          i + 1,
          interpolationType(inName),
          interpolationType(outName)
        );
        if (key.spatial) {
          prop.setSpatialTangentsAtKey(i + 1, key.spatial.inTan, key.spatial.outTan);
          prop.setSpatialAutoBezierAtKey(i + 1, key.spatial.auto);
          prop.setSpatialContinuousAtKey(i + 1, key.spatial.continuous);
          if (i > 0 && i < value.keys.length - 1) prop.setRovingAtKey(i + 1, key.spatial.roving);
        }
      }
    } else {
      for (i = prop.numKeys; i >= 1; i--) prop.removeKey(i);
      prop.setValue(value.value);
    }
    if (prop.canSetExpression) {
      // A state without "expression" means the property has none, so an existing one is cleared.
      wantedExpression = typeof value.expression === 'string' ? value.expression : '';
      if (prop.expression !== wantedExpression) prop.expression = wantedExpression;
      if (wantedExpression && typeof value.expressionEnabled === 'boolean')
        prop.expressionEnabled = value.expressionEnabled;
    }
  }

  function writeTextDocument(prop, field, wanted) {
    var document = prop.value;
    if (field === 'justification') {
      if (wanted === 'CENTER') document.justification = ParagraphJustification.CENTER_JUSTIFY;
      else if (wanted === 'RIGHT') document.justification = ParagraphJustification.RIGHT_JUSTIFY;
      else document.justification = ParagraphJustification.LEFT_JUSTIFY;
    } else document[field] = wanted;
    prop.setValue(document);
  }

  function writeTextKeys(prop, keys, comp) {
    var i,
      key,
      document,
      template = prop.value;
    for (i = prop.numKeys; i >= 1; i--) prop.removeKey(i);
    for (i = 0; i < keys.length; i++) {
      key = keys[i];
      document = template;
      for (var field in key.v)
        if (key.v.hasOwnProperty(field)) {
          if (field === 'justification') {
            if (key.v[field] === 'CENTER')
              document.justification = ParagraphJustification.CENTER_JUSTIFY;
            else if (key.v[field] === 'RIGHT')
              document.justification = ParagraphJustification.RIGHT_JUSTIFY;
            else document.justification = ParagraphJustification.LEFT_JUSTIFY;
          } else document[field] = key.v[field];
        }
      prop.setValueAtTime(seconds(key.f, comp), document);
      prop.setInterpolationTypeAtKey(
        i + 1,
        KeyframeInterpolationType.HOLD,
        KeyframeInterpolationType.HOLD
      );
    }
  }

  function setAtPath(comp, path, wanted) {
    var match = /^L(\d+)\.(.+)$/.exec(path),
      layer,
      tail,
      effectMatch,
      effect,
      prop,
      name;
    if (!match) throw new Error('LAYER_MISSING');
    layer = layerById(Number(match[1]));
    tail = match[2];
    if (tail === 'name') {
      layer.name = wanted;
      return;
    }
    if (tail.indexOf('attr.') === 0) {
      name = tail.substr(5);
      if (name === 'inPoint' || name === 'outPoint' || name === 'startTime')
        layer[name] = seconds(wanted, comp);
      else if (name === 'parentId') layer.parent = wanted === null ? null : layerById(wanted);
      else if (name === 'threeD') layer.threeDLayer = wanted;
      else if (name === 'blendingMode') layer.blendingMode = BlendingMode[wanted];
      else layer[name] = wanted;
      return;
    }
    if (tail.indexOf('transform.') === 0) {
      prop = transformProperty(layer, tail.substr(10));
      if (!prop) throw new Error('LAYER_MISSING');
      writeProperty(prop, wanted, comp);
      return;
    }
    if (tail === 'timeRemap') {
      if (!layer.timeRemapEnabled) layer.timeRemapEnabled = true;
      prop = layer.property('ADBE Time Remapping');
      if (!prop) throw new Error('LAYER_MISSING');
      writeProperty(prop, wanted, comp);
      return;
    }
    if (tail.indexOf('text.') === 0) {
      prop = layer.property('ADBE Text Properties').property('ADBE Text Document');
      if (!prop) throw new Error('LAYER_MISSING');
      if (tail === 'text.keys') writeTextKeys(prop, wanted, comp);
      else writeTextDocument(prop, tail.substr(9), wanted);
      return;
    }
    effectMatch = /^fx\[(\d+):([^\]]+)\]\.(enabled|params\.(.+))$/.exec(tail);
    if (effectMatch) {
      effect = effectByPath(layer, Number(effectMatch[1]), effectMatch[2]);
      if (!effect) throw new Error('LAYER_MISSING');
      if (effectMatch[3] === 'enabled') effect.enabled = wanted;
      else {
        prop = paramByName(effect, effectMatch[4]);
        if (!prop) throw new Error('LAYER_MISSING');
        if (wanted.value && (typeof wanted.value.value !== 'undefined' || wanted.value.keys))
          writeProperty(prop, wanted.value, comp);
        else writeProperty(prop, { value: wanted.value }, comp);
      }
      return;
    }
    throw new Error('LAYER_MISSING');
  }

  function applyChanges(args) {
    var comp = compById(args.compId),
      start = new Date().getTime(),
      i,
      change,
      live,
      layer;
    var planned = [],
      conflicts = [],
      noop = 0,
      after = {},
      prior = [],
      unlocked = {};
    for (i = 0; i < args.changes.length; i++) {
      change = args.changes[i];
      try {
        layer = layerById(Number(/^L(\d+)/.exec(change.path)[1]));
        if (layer.locked && !args.unlock)
          return fail('LAYER_LOCKED', 'Layer is locked', { layerId: layer.id });
        live = valueAtPath(comp, change.path);
        if (
          (live === null && !/\.attr\.parentId$/.test(change.path)) ||
          typeof live === 'undefined'
        ) {
          conflicts.push({ path: change.path, base: change.base, live: null, want: change.want });
        } else if (deepEqual(live, change.base)) planned.push(change);
        else if (deepEqual(live, change.want)) {
          noop++;
          after[change.path] = live;
        } else if (args.onConflict === 'force') planned.push(change);
        else
          conflicts.push({ path: change.path, base: change.base, live: live, want: change.want });
      } catch (missing) {
        conflicts.push({ path: change.path, base: change.base, live: null, want: change.want });
      }
    }
    if (args.onConflict === 'abort' && conflicts.length)
      return fail('CONFLICT', 'Live value changed', { conflicts: conflicts });
    if (args.dryRun)
      return {
        ok: true,
        applied: planned.length,
        noop: noop,
        conflicts: conflicts,
        warnings: [],
        undoLabel: args.undoLabel,
        ms: new Date().getTime() - start,
        after: after
      };
    if (planned.length === 0)
      return {
        ok: true,
        applied: 0,
        noop: noop,
        conflicts: conflicts,
        warnings: [],
        undoLabel: args.undoLabel,
        ms: new Date().getTime() - start,
        after: after
      };
    planned.sort(function (left, right) {
      function rank(path) {
        if (/\.attr\.startTime$/.test(path)) return 0;
        if (/\.attr\.inPoint$/.test(path)) return 1;
        if (/\.attr\.outPoint$/.test(path)) return 2;
        return 3;
      }
      return rank(left.path) - rank(right.path);
    });
    app.beginUndoGroup('aebridge: ' + args.undoLabel);
    try {
      for (i = 0; i < planned.length; i++) {
        change = planned[i];
        layer = layerById(Number(/^L(\d+)/.exec(change.path)[1]));
        if (layer.locked) {
          layer.locked = false;
          unlocked[layer.id] = layer;
        }
        prior.push({ path: change.path, value: valueAtPath(comp, change.path) });
        setAtPath(comp, change.path, change.want);
        after[change.path] = valueAtPath(comp, change.path);
      }
    } catch (error) {
      for (i = prior.length - 1; i >= 0; i--) {
        try {
          setAtPath(comp, prior[i].path, prior[i].value);
        } catch (ignored) {}
      }
      return fail('JSX_ERROR', error, { line: error.line || null, source: error.fileName || null });
    } finally {
      for (var id in unlocked) if (unlocked.hasOwnProperty(id)) unlocked[id].locked = true;
      app.endUndoGroup();
    }
    return {
      ok: true,
      applied: planned.length,
      noop: noop,
      conflicts: conflicts,
      warnings: [],
      undoLabel: args.undoLabel,
      ms: new Date().getTime() - start,
      after: after
    };
  }

  function saveFrame(args) {
    // saveFrameToPng returns before the file is written (measured on AE 26.0), so the comp
    // resolution cannot be lowered around the call. The frame is saved at full size and the
    // hub waits for the file and scales it.
    var comp = compById(args.compId),
      destination = new File(args.outPath);
    comp.saveFrameToPng(seconds(args.frame, comp), destination);
    return { ok: true, path: args.outPath, width: comp.width, height: comp.height };
  }

  function runJsx(args) {
    var fn = new Function('args', args.code),
      value;
    app.beginUndoGroup('aebridge: ' + (args.undoLabel || 'run_jsx'));
    try {
      value = fn(args.args || {});
    } finally {
      app.endUndoGroup();
    }
    return { ok: true, value: typeof value === 'undefined' ? null : value };
  }

  AEB.dispatch = function (call, argsPath, resultPath) {
    var args, result, code;
    try {
      app.beginSuppressDialogs();
      args = read(argsPath);
      if (call === 'status') result = status();
      else if (call === 'list_comps') result = listComps();
      else if (call === 'export_comp') result = exportComp(args);
      else if (call === 'apply_changes') result = applyChanges(args);
      else if (call === 'save_frame') result = saveFrame(args);
      else if (call === 'run_jsx') result = runJsx(args);
      else result = fail('UNSUPPORTED_CHANGE', 'Unknown host call: ' + call);
    } catch (error) {
      // No nested ternary here: ExtendScript groups a?x:b?y:z differently from JavaScript.
      code = 'JSX_ERROR';
      if (String(error).indexOf('COMP_NOT_FOUND') >= 0) code = 'COMP_NOT_FOUND';
      else if (String(error).indexOf('LAYER_MISSING') >= 0) code = 'LAYER_MISSING';
      result = fail(code, error, { line: error.line || null, source: error.fileName || null });
    } finally {
      try {
        app.endSuppressDialogs(false);
      } catch (ignored) {}
    }
    try {
      write(resultPath, result);
      return 'ok';
    } catch (writeError) {
      return 'write error: ' + String(writeError);
    }
  };
})();

// P1 request operations. Kept separate from the legacy composition-state transport.
(function () {
  var legacyDispatch = AEB.dispatch;
  var properties = ['position', 'scale', 'rotation', 'opacity', 'inPoint', 'outPoint'];
  var matches = {
    position: 'ADBE Position',
    scale: 'ADBE Scale',
    rotation: 'ADBE Rotate Z',
    opacity: 'ADBE Opacity'
  };

  function fail(code, message, results) {
    return {
      ok: false,
      error: { code: code, message: String(message), details: { results: results || [] } }
    };
  }

  function projectIdentity() {
    var project = app.project,
      root = project.rootFolder || null,
      rootId = root ? root.id : null;
    if (
      AEB.p1ProjectRef !== project ||
      AEB.p1ProjectRootRef !== root ||
      AEB.p1ProjectRootId !== rootId
    ) {
      AEB.p1ProjectRef = project;
      AEB.p1ProjectRootRef = root;
      AEB.p1ProjectRootId = rootId;
      AEB.p1ProjectSession = String(new Date().getTime()) + '-' + String(Math.random());
    }
    return {
      session: AEB.p1ProjectSession,
      path: project.file ? project.file.fsName.replace(/\\/g, '/') : ''
    };
  }

  function same(left, right) {
    var i;
    if (typeof left === 'number' && typeof right === 'number')
      return isFinite(left) && isFinite(right) && left === right;
    if (left instanceof Array && right instanceof Array) {
      if (left.length !== right.length) return false;
      for (i = 0; i < left.length; i++) if (!same(left[i], right[i])) return false;
      return true;
    }
    return left === right;
  }

  function knownProperty(name) {
    var i;
    for (i = 0; i < properties.length; i++) if (properties[i] === name) return true;
    return false;
  }

  function canonicalFrame(value) {
    return Math.round(value * 1000000) / 1000000;
  }

  function isTiming(name) {
    return name === 'inPoint' || name === 'outPoint';
  }

  function retained(layer, op, comp, observed) {
    return (
      same(observed, op.value) &&
      (!isTiming(op.property) || layer[op.property] === op.value / comp.frameRate)
    );
  }

  function uncertainTiming(layer, op, comp) {
    return (
      isTiming(op.property) &&
      layer[op.property] !== op.value / comp.frameRate &&
      layer[op.property] !== op.before / comp.frameRate
    );
  }

  function validValue(name, value, comp) {
    var i;
    if (name === 'position' || name === 'scale') {
      if (!(value instanceof Array) || value.length !== 2) return false;
      for (i = 0; i < 2; i++) if (typeof value[i] !== 'number' || !isFinite(value[i])) return false;
      return true;
    }
    if (typeof value !== 'number' || !isFinite(value)) return false;
    if (name === 'opacity') return value >= 0 && value <= 100;
    if (name === 'inPoint' || name === 'outPoint') return Math.abs(value / comp.frameRate) <= 10800;
    return name === 'rotation';
  }

  function findLayer(comp, id) {
    var i, layer;
    for (i = 1; i <= comp.numLayers; i++) {
      layer = comp.layer(i);
      if (layer.id === id) return layer;
    }
    return null;
  }

  function propertyInfo(layer, name, comp) {
    var prop,
      group,
      value = null,
      reason = '';
    if (layer.threeDLayer) reason = '3D_LAYER';
    else if (layer.locked) reason = 'LAYER_LOCKED';
    if (name === 'inPoint' || name === 'outPoint') {
      value = canonicalFrame(layer[name] * comp.frameRate);
      if (layer[name] !== value / comp.frameRate) reason = reason || 'UNREPRESENTABLE_TIME';
    } else {
      group = layer.property('ADBE Transform Group');
      prop = group ? group.property(matches[name]) : null;
      if (!prop) reason = reason || 'PROPERTY_MISSING';
      else {
        if (prop.numKeys > 0) reason = reason || 'KEYFRAMED';
        if (prop.canSetExpression && (prop.expression || prop.expressionEnabled))
          reason = reason || 'EXPRESSION';
        if (name === 'position' && prop.dimensionsSeparated)
          reason = reason || 'SEPARATED_DIMENSIONS';
        try {
          value = prop.valueAtTime(comp.time, false);
          if (
            !layer.threeDLayer &&
            value instanceof Array &&
            value.length === 3 &&
            ((name === 'position' && value[2] === 0) || (name === 'scale' && value[2] === 100))
          )
            value = value.slice(0, 2);
          if (value instanceof Array) value = value.slice(0);
        } catch (readError) {
          reason = reason || 'READ_ERROR';
        }
      }
    }
    if (!validValue(name, value, comp)) {
      reason = reason || 'UNSUPPORTED_VALUE';
      value = null;
    }
    return { value: value, supported: !reason, reason: reason };
  }

  function targetComp(params) {
    var identity = projectIdentity(),
      comp = app.project.activeItem;
    if (
      params.project &&
      (params.project.session !== identity.session || params.project.path !== identity.path)
    )
      throw new Error('PROJECT_CHANGED');
    if (!(comp instanceof CompItem)) throw new Error('COMP_NOT_FOUND');
    if (typeof params.compId !== 'undefined' && params.compId !== comp.id)
      throw new Error('COMP_CHANGED');
    return comp;
  }

  function readProps(params) {
    var comp = targetComp(params),
      selected = comp.selectedLayers,
      layers = [],
      ids = params.targetLayerIds;
    var i, j, layer, record;
    if (ids && !(ids instanceof Array))
      return fail('INVALID_ARGS', 'targetLayerIds must be an array');
    if (!(ids ? ids.length : selected.length))
      return fail('NO_SELECTION', 'Select at least one layer');
    for (i = 0; i < (ids ? ids.length : selected.length); i++) {
      layer = ids ? findLayer(comp, ids[i]) : selected[i];
      if (!layer) return fail('LAYER_MISSING', 'Pinned layer no longer belongs to the composition');
      record = {
        id: layer.id,
        name: layer.name,
        index: layer.index,
        threeD: Boolean(layer.threeDLayer),
        locked: Boolean(layer.locked),
        properties: {}
      };
      for (j = 0; j < properties.length; j++)
        record.properties[properties[j]] = propertyInfo(layer, properties[j], comp);
      layers.push(record);
    }
    return {
      ok: true,
      snapshot: {
        project: projectIdentity(),
        comp: {
          id: comp.id,
          name: comp.name,
          frameRate: comp.frameRate,
          durationFrames: comp.duration * comp.frameRate
        },
        layers: layers
      }
    };
  }

  function applyOps(params) {
    var comp,
      ops = params.operations,
      ids = params.targetLayerIds,
      planned = [],
      seen = {},
      timings = {};
    var i,
      j,
      op,
      layer,
      info,
      allowed,
      path,
      key,
      timing,
      nativeValue,
      results = [],
      result,
      observed,
      started = false;
    if (
      !params.project ||
      typeof params.compId !== 'number' ||
      typeof params.summary !== 'string' ||
      !(ops instanceof Array) ||
      !ops.length ||
      !(ids instanceof Array)
    )
      return fail('INVALID_ARGS', 'A pinned target, summary and operations are required');
    comp = targetComp(params);
    // All operations are read and checked before the first Undo Group or write.
    for (i = 0; i < ops.length; i++) {
      op = ops[i];
      if (!op || typeof op.layerId !== 'number' || !knownProperty(op.property))
        return fail('INVALID_ARGS', 'Unknown operation');
      allowed = false;
      for (j = 0; j < ids.length; j++) if (ids[j] === op.layerId) allowed = true;
      if (!allowed) return fail('TARGET_MISMATCH', 'Layer is outside the pinned target');
      layer = findLayer(comp, op.layerId);
      if (!layer) return fail('LAYER_MISSING', 'Layer no longer belongs to the composition');
      path = 'L' + op.layerId + '.' + op.property;
      if (seen[path]) return fail('INVALID_ARGS', 'Duplicate property operation');
      seen[path] = true;
      info = propertyInfo(layer, op.property, comp);
      if (!info.supported)
        return fail(
          info.reason === 'UNREPRESENTABLE_TIME' ? 'CONFLICT' : 'UNSUPPORTED_CHANGE',
          path + ': ' + info.reason
        );
      if (!validValue(op.property, op.value, comp) || !validValue(op.property, op.before, comp))
        return fail('INVALID_ARGS', 'Unsupported property value: ' + path);
      if (!same(info.value, op.before)) return fail('CONFLICT', 'Live value changed: ' + path);
      // Canonical frame display must never hide a small native-time human edit.
      if (isTiming(op.property) && layer[op.property] !== op.before / comp.frameRate)
        return fail('CONFLICT', 'Native timing changed or is not exactly representable: ' + path);
      planned.push({
        operation: op,
        layer: layer,
        path: path,
        before: info.value,
        originalIndex: i
      });
      if (op.property === 'position' || op.property === 'scale') {
        nativeValue = layer
          .property('ADBE Transform Group')
          .property(matches[op.property])
          .valueAtTime(comp.time, false);
        if (nativeValue instanceof Array && nativeValue.length === 3)
          planned[planned.length - 1].nativeZ = nativeValue[2];
      }
      key = 'L' + op.layerId;
      if (!timings[key])
        timings[key] = {
          beforeIn: layer.inPoint * comp.frameRate,
          beforeOut: layer.outPoint * comp.frameRate,
          inPoint: layer.inPoint * comp.frameRate,
          outPoint: layer.outPoint * comp.frameRate
        };
      if (op.property === 'inPoint' || op.property === 'outPoint')
        timings[key][op.property] = op.value;
    }
    for (key in timings)
      if (timings.hasOwnProperty(key)) {
        timing = timings[key];
        if (timing.inPoint >= timing.outPoint)
          return fail('INVALID_ARGS', 'inPoint must be before outPoint');
      }
    planned.sort(function (left, right) {
      function rank(item) {
        var time = timings['L' + item.layer.id];
        if (item.operation.property === 'outPoint' && time.inPoint >= time.beforeOut) return -1;
        if (item.operation.property === 'inPoint' && time.outPoint <= time.beforeIn) return -1;
        return 0;
      }
      return rank(left) - rank(right) || left.originalIndex - right.originalIndex;
    });
    try {
      app.beginUndoGroup('aebridge: ' + params.summary);
      started = true;
      for (i = 0; i < planned.length; i++) {
        op = planned[i].operation;
        layer = planned[i].layer;
        result = {
          path: planned[i].path,
          before: planned[i].before,
          requested: op.value,
          observedAfter: null,
          success: false
        };
        results.push(result);
        if (op.property === 'inPoint' || op.property === 'outPoint')
          layer[op.property] = op.value / comp.frameRate;
        else
          layer
            .property('ADBE Transform Group')
            .property(matches[op.property])
            .setValue(
              typeof planned[i].nativeZ === 'number'
                ? [op.value[0], op.value[1], planned[i].nativeZ]
                : op.value
            );
        observed = propertyInfo(layer, op.property, comp).value;
        result.observedAfter = observed;
        result.success = retained(layer, op, comp, observed);
        if (!result.success && uncertainTiming(layer, op, comp)) result.observedAfter = null;
        if (!result.success)
          return fail('APPLY_MISMATCH', 'Host did not retain the requested value', results);
      }
    } catch (error) {
      if (results.length) {
        result = results[results.length - 1];
        try {
          result.observedAfter = propertyInfo(layer, op.property, comp).value;
          result.success = retained(layer, op, comp, result.observedAfter);
          if (!result.success && uncertainTiming(layer, op, comp)) result.observedAfter = null;
        } catch (ignoredRead) {}
        result.error = String(error);
      }
      return fail('JSX_ERROR', error, results);
    } finally {
      if (started) {
        try {
          app.endUndoGroup();
        } catch (closeError) {
          return fail('JSX_ERROR', closeError, results);
        }
      }
    }
    return { ok: true, results: results };
  }

  function encode(value) {
    var i,
      key,
      parts = [];
    if (value === null || typeof value === 'undefined') return 'null';
    if (typeof value === 'number') return isFinite(value) ? String(value) : 'null';
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'string')
      return (
        '"' +
        value.replace(/[\u0000-\u001f\u2028\u2029\\"]/g, function (character) {
          var hex = character.charCodeAt(0).toString(16);
          while (hex.length < 4) hex = '0' + hex;
          return '\\u' + hex;
        }) +
        '"'
      );
    if (value instanceof Array) {
      for (i = 0; i < value.length; i++) parts.push(encode(value[i]));
      return '[' + parts.join(',') + ']';
    }
    for (key in value)
      if (value.hasOwnProperty(key)) parts.push(encode(key) + ':' + encode(value[key]));
    return '{' + parts.join(',') + '}';
  }

  AEB.dispatch = function (call, argsPath, resultPath) {
    var input, output, args, result, code;
    if (call !== 'read_props' && call !== 'apply_ops')
      return legacyDispatch(call, argsPath, resultPath);
    try {
      app.beginSuppressDialogs();
      input = new File(argsPath);
      input.encoding = 'UTF-8';
      if (!input.open('r')) throw new Error('Cannot open P1 arguments');
      try {
        args = eval('(' + input.read() + ')');
      } finally {
        input.close();
      }
      if (call === 'read_props') result = readProps(args);
      else result = applyOps(args);
    } catch (error) {
      code = 'JSX_ERROR';
      if (/PROJECT_CHANGED|COMP_CHANGED|COMP_NOT_FOUND/.test(String(error)))
        code = 'TARGET_MISMATCH';
      result = fail(code, error);
    } finally {
      try {
        app.endSuppressDialogs(false);
      } catch (ignored) {}
    }
    try {
      output = new File(resultPath);
      output.encoding = 'UTF-8';
      if (!output.open('w')) throw new Error('Cannot open P1 result');
      try {
        output.write(encode(result));
      } finally {
        output.close();
      }
      return 'ok';
    } catch (writeError) {
      return 'write error: ' + String(writeError);
    }
  };
})();
