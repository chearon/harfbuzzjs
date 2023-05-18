#!/bin/bash
set -e

em++ \
	-std=c++11 \
	-fno-exceptions \
	-fno-rtti \
	-fno-threadsafe-statics \
	-fvisibility-inlines-hidden \
	-flto \
	-Oz \
	-I. \
	-DHB_TINY \
	-DHB_USE_INTERNAL_QSORT \
	-DHB_CONFIG_OVERRIDE_H=\"config-override.h\" \
	-DHB_EXPERIMENTAL_API \
	--no-entry \
	-s EXPORTED_FUNCTIONS=@hbjs.symbols \
	-s ERROR_ON_UNDEFINED_SYMBOLS=0 \
	-s WARN_ON_UNDEFINED_SYMBOLS=0 \
	-s INITIAL_MEMORY=65MB \
	-o hb.wasm \
	hbjs.cc
