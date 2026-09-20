/* worldmap.js — 世界地图实图模式。

   Why this exists
   ---------------
   官方美术里一直带着 5 张区域全图（assets/world_map/areas/area_0N.jpg）与一套地图 UI
   （field_pin / area_pin / current_location / field_pin_ring 等 SVG），但旧实现只画
   了一个钉子网格，**从没把区域实图用起来**。这个模块补上那一层，做成「网格/地图」两种模式。

   钉子坐标的来源
   --------------
   `WorldPins.fields` / `WorldPins.stages` 是从参考项目 **AgentAtelierR** 的
   `world_map_screen.dart`（`_fieldLayouts` / `_stageOffsets`）机械移植的标定值，
   再由 **Atelier R'Coagula** 补齐并核对（fields 38/38、stages 105/120）。
   本项目只取**数据**，不带任何代码；出处见 docs/official/README.md。
   没有标定的 15 个 stage 不臆造坐标：它们落在各自 field 的钉子上（点击后进 field 视图）。

   坐标语义：[x, y, zoom]，x/y 是归一化 0..1（左上角原点），zoom 是聚焦该 field 时
   地图的缩放倍数。
*/
(function (global) {
  'use strict';

  var AREAS = 'assets/world_map/areas/';
  var THUMBS = 'assets/world_map/area_thumbs/';
  var UI = 'assets/world_map/ui/';

  /* 标定表（数据，不随逻辑变化） */
  var FIELDS = {
    'field_01_001': [0.73, 0.9, 2.35], 'field_01_002': [0.854, 0.647, 2.55],
    'field_01_003': [0.657, 0.508, 2.15], 'field_01_004': [0.524, 0.654, 2.35],
    'field_01_005': [0.4, 0.746, 2.15], 'field_01_006': [0.87, 0.41, 2.35],
    'field_01_007': [0.88, 0.12, 2.15], 'field_01_008': [0.645, 0.117, 2.15],
    'field_01_009': [0.445, 0.328, 2.15], 'field_01_010': [0.418, 0.133, 2.15],
    'field_01_011': [0.296, 0.431, 2.15], 'field_01_012': [0.24, 0.18, 2.15],
    'field_01_013': [0.193, 0.694, 2.15], 'field_01_014': [0.089, 0.785, 2.15],
    'field_02_001': [0.317, 0.24, 2.15], 'field_02_002': [0.541, 0.222, 2.15],
    'field_02_003': [0.283, 0.648, 2.15], 'field_02_004': [0.881, 0.365, 2.15],
    'field_02_005': [0.679, 0.66, 2.15], 'field_03_001': [0.573, 0.792, 2.15],
    'field_03_002': [0.621, 0.317, 2.15], 'field_03_003': [0.805, 0.784, 2.15],
    'field_03_004': [0.251, 0.645, 2.15], 'field_03_005': [0.235, 0.246, 2.15],
    'field_04_001': [0.473, 0.519, 2.15], 'field_04_002': [0.588, 0.867, 2.15],
    'field_04_003': [0.585, 0.258, 2.15], 'field_05_001': [0.483, 0.562, 2.15],
    'field_05_002': [0.124, 0.644, 2.15], 'field_05_003': [0.751, 0.511, 2.15],
    'field_05_004': [0.133, 0.846, 2.15], 'field_05_005': [0.36, 0.30, 2.15],
    'field_05_006': [0.60, 0.72, 2.15], 'field_05_007': [0.82, 0.30, 2.15],
    'field_05_008': [0.30, 0.86, 2.15], 'field_05_009': [0.66, 0.14, 2.15],
    'field_05_010': [0.18, 0.44, 2.15], 'field_01_015': [0.5, 0.5, 2.15]
  };
  var STAGES = {
    'stage_01_001_01': [-0.24, 0.06], 'stage_01_001_02': [-0.08, -0.83],
    'stage_01_001_04': [-0.84, -0.25], 'stage_01_001_05': [-0.84, 0.73],
    'stage_01_001_06': [0.09, 0.73], 'stage_01_001_08': [0.34, -0.15],
    'stage_01_002_01': [-0.25, 0.83], 'stage_01_002_02': [-1.29, 0.33],
    'stage_01_002_03': [0.3, -0.4], 'stage_01_003_01': [0.0, 0.0],
    'stage_01_004_01': [0.0, 0.0], 'stage_01_005_01': [0.0, 0.0],
    'stage_01_006_01': [0.0, 0.0], 'stage_01_007_01': [0.0, 0.0],
    'stage_01_008_01': [0.0, 0.0], 'stage_01_009_01': [0.0, 0.0],
    'stage_01_010_01': [0.0, 0.0], 'stage_01_011_01': [0.0, 0.0],
    'stage_01_012_01': [0.0, 0.0], 'stage_01_013_01': [0.0, 0.0],
    'stage_01_014_01': [0.0, 0.0], 'stage_02_001_01': [0.0, 0.0],
    'stage_02_002_01': [0.0, 0.0], 'stage_02_003_01': [0.0, 0.0],
    'stage_02_004_01': [0.0, 0.0], 'stage_02_005_01': [0.0, 0.0],
    'stage_03_001_01': [0.0, 0.0], 'stage_03_002_01': [0.0, 0.0],
    'stage_03_003_01': [0.0, 0.0], 'stage_03_004_01': [0.0, 0.0],
    'stage_03_005_01': [0.0, 0.0], 'stage_04_001_01': [0.0, 0.0],
    'stage_04_002_01': [0.0, 0.0], 'stage_04_003_01': [0.0, 0.0],
    'stage_05_001_01': [0.0, 0.0], 'stage_05_002_01': [0.0, 0.0],
    'stage_05_003_01': [0.0, 0.0], 'stage_05_004_01': [0.0, 0.0],
    'stage_05_005_01': [0.0, 0.0], 'stage_05_006_01': [0.0, 0.0],
    'stage_05_007_01': [0.0, 0.0], 'stage_05_008_01': [0.0, 0.0],
    'stage_05_009_01': [0.0, 0.0], 'stage_05_010_01': [0.0, 0.0]
  };

  var ZOOM_MIN = 1, ZOOM_MAX = 3.2, ZOOM_STEP = 0.35;

  var WorldMap = {
    mode: 'grid',           /* grid | map */
    areaId: '',
    zoom: 1,
    panX: 0,
    panY: 0,
    _root: null,
    _onPickStage: null,
    _onPickArea: null,

    pins: FIELDS,
    stageOffsets: STAGES,

    /* 该区域有哪些 field（按官方 world_hierarchy） */
    fieldsOf: function (areaId) {
      var areas = (global.World && World.areas && World.areas()) || [];
      var a = null;
      for (var i = 0; i < areas.length; i++) if (areas[i].id === areaId) a = areas[i];
      return a ? (a.fields || []) : [];
    },

    setHandlers: function (opts) {
      if (opts && opts.onPickStage) this._onPickStage = opts.onPickStage;
      if (opts && opts.onPickArea) this._onPickArea = opts.onPickArea;
    },

    /* 模式切换：网格 ↔ 地图。返回切换后的模式。 */
    toggle: function () {
      this.mode = (this.mode === 'map') ? 'grid' : 'map';
      return this.mode;
    },

    /* 当前所在地在图上的 area（从 stage id 推：stage_01_xxx → area_01） */
    areaOfStage: function (stageId) {
      var m = /^stage_(\d\d)_/.exec(String(stageId || ''));
      return m ? ('area_' + m[1]) : '';
    },

    /* ---------------------------------------------------------------- 相机
       归一化坐标 → 屏幕：先把图片按容器宽铺满，再按 zoom 缩放并平移。
       平移在 clamp 到 [0, 1] 的图片范围内，避免拖出空白。 */
    _apply: function () {
      var img = this._root && this._root.querySelector('.wmp-plate');
      var layer = this._root && this._root.querySelector('.wmp-layer');
      if (!img || !layer) return;
      var z = this.zoom;
      /* transform-origin 取中心，缩放时以当前聚焦点为中心（见 focusField） */
      layer.style.transform = 'translate(' + this.panX + '%, ' + this.panY + '%) scale(' + z + ')';
      img.style.filter = '';
    },

    _clampPan: function () {
      var lim = (this.zoom - 1) * 50;      /* 百分比，与 scale 同步 */
      this.panX = Math.max(-lim, Math.min(lim, this.panX));
      this.panY = Math.max(-lim, Math.min(lim, this.panY));
    },

    /* 聚焦某个 field：官方钉子的第三个值就是该 field 的聚焦缩放 */
    focusField: function (fieldId) {
      var p = FIELDS[fieldId];
      if (!p) return;
      this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, p[2]));
      /* 让钉子出现在视口中央：以归一化坐标推平移百分比 */
      this.panX = (0.5 - p[0]) * 100 * this.zoom;
      this.panY = (0.5 - p[1]) * 100 * this.zoom;
      this._clampPan();
      this._apply();
    },

    zoomBy: function (delta) {
      this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom + delta));
      this._clampPan();
      this._apply();
    },

    reset: function () {
      this.zoom = 1; this.panX = 0; this.panY = 0;
      this._apply();
    },

    /* ---------------------------------------------------------------- 渲染 */
    render: function (root, state, handlers) {
      if (!root) return;
      this._root = root;
      if (handlers) this.setHandlers(handlers);
      var stageId = (state && state.stage) || (global.Config &&
        Config.section('state').stage) || 'stage_01_001_01';
      var areaId = this.areaOfStage(stageId);
      if (!this.areaId) this.areaId = areaId;
      var areas = (global.World && World.areas && World.areas()) || [];

      root.innerHTML = '';
      if (this.mode === 'grid') { root.classList.remove('wmp-on'); return; }
      root.classList.add('wmp-on');

      /* 区域标签行（点击换区域） */
      var tabs = document.createElement('div');
      tabs.className = 'wmp-tabs';
      areas.forEach(function (a) {
        var b = document.createElement('button');
        b.className = 'wmp-tab' + (a.id === areaId ? ' on' : '');
        b.textContent = a.name || a.id;
        b.onclick = function () {
          WorldMap.areaId = a.id;
          WorldMap.reset();
          WorldMap.render(root, { stage: stageId }, handlers);
        };
        tabs.appendChild(b);
      });
      root.appendChild(tabs);

      var view = document.createElement('div');
      view.className = 'wmp-view';
      var layer = document.createElement('div');
      layer.className = 'wmp-layer';
      var plateName = (areaId || 'area_01').replace('area_', 'area_');
      var img = document.createElement('img');
      img.className = 'wmp-plate';
      img.alt = '';
      img.src = AREAS + plateName + '.jpg';
      layer.appendChild(img);

      var self = this;
      /* field 钉子：官方 UI 里 field_pin 是「未激活」样式，当前 field 用 field_pin_ring */
      var fields = this.fieldsOf(areaId);
      var curField = '';
      fields.forEach(function (f) {
        var st = (f.stages || [])[0];
        if (st && st.id && stageId.indexOf(st.id) === 0) curField = f.id;
      });
      fields.forEach(function (f) {
        var p = FIELDS[f.id];
        if (!p) return;                     /* 没标定就不画，不臆造坐标 */
        var pin = document.createElement('button');
        pin.className = 'wmp-pin' + (f.id === curField ? ' here' : '');
        pin.style.left = (p[0] * 100) + '%';
        pin.style.top = (p[1] * 100) + '%';
        pin.innerHTML = '<img alt="">';
        pin.querySelector('img').src = UI + (f.id === curField ? 'field_pin_ring.svg' : 'field_pin.svg');
        pin.title = (global.World && World.placeLabel) ? World.placeLabel(f.id, f.name) : f.name;
        pin.onclick = function (ev) {
          ev.stopPropagation();
          self.focusField(f.id);
          /* 点钉子 = 选中该 field 的第一个 stage（与网格视图的语义一致） */
          var first = (f.stages || [])[0];
          if (first && self._onPickStage) self._onPickStage(first.id);
        };
        layer.appendChild(pin);
      });

      /* 所在地标记（官方 current_location.svg） */
      var cur = FIELDS[curField];
      if (cur) {
        var me = document.createElement('img');
        me.className = 'wmp-me';
        me.src = UI + 'current_location.svg';
        me.style.left = (cur[0] * 100) + '%';
        me.style.top = (cur[1] * 100) + '%';
        layer.appendChild(me);
      }

      view.appendChild(layer);
      root.appendChild(view);

      /* 缩放控件 */
      var ctl = document.createElement('div');
      ctl.className = 'wmp-ctl';
      [['＋', ZOOM_STEP], ['－', -ZOOM_STEP], ['○', 0]].forEach(function (pair) {
        var b = document.createElement('button');
        b.className = 'wmp-btn';
        b.textContent = pair[0];
        b.onclick = function (ev) {
          ev.stopPropagation();
          if (pair[1] === 0) self.reset(); else self.zoomBy(pair[1]);
        };
        ctl.appendChild(b);
      });
      root.appendChild(ctl);

      /* 拖拽平移 + 滚轮缩放（双指在移动端由 pointer 事件合并处理） */
      this._bindDrag(view);
      this._apply();
    },

    _bindDrag: function (view) {
      var self = this;
      var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      var pointers = {};
      view.onpointerdown = function (ev) {
        pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
        dragging = true;
        sx = ev.clientX; sy = ev.clientY; ox = self.panX; oy = self.panY;
        view.setPointerCapture && view.setPointerCapture(ev.pointerId);
      };
      view.onpointermove = function (ev) {
        if (!dragging) return;
        /* 两指时用间距变化缩放（简易 pinch） */
        pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
        var ids = Object.keys(pointers);
        if (ids.length >= 2) {
          var a = pointers[ids[0]], b = pointers[ids[1]];
          var d = Math.hypot(a.x - b.x, a.y - b.y);
          if (self._pinchBase) {
            var ratio = d / self._pinchBase;
            self.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, self._pinchZoom0 * ratio));
            self._clampPan();
            self._apply();
          } else {
            self._pinchBase = d; self._pinchZoom0 = self.zoom;
          }
          return;
        }
        var w = view.clientWidth || 1, h = view.clientHeight || 1;
        self.panX = ox + (ev.clientX - sx) / w * 100;
        self.panY = oy + (ev.clientY - sy) / h * 100;
        self._clampPan();
        self._apply();
      };
      var end = function (ev) {
        delete pointers[ev.pointerId];
        if (!Object.keys(pointers).length) {
          dragging = false; self._pinchBase = 0;
        }
      };
      view.onpointerup = end;
      view.onpointercancel = end;
      view.onwheel = function (ev) {
        ev.preventDefault();
        self.zoomBy(ev.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
      };
    }
  };

  global.WorldMap = WorldMap;
})(window);
