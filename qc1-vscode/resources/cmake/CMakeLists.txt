cmake_minimum_required(VERSION 3.20)

project(qc1_stm32_firmware LANGUAGES C ASM)

if(NOT QC1_PROJECT_ROOT)
  message(FATAL_ERROR "QC1_PROJECT_ROOT is required")
endif()

cmake_path(ABSOLUTE_PATH QC1_PROJECT_ROOT NORMALIZE OUTPUT_VARIABLE QC1_ROOT)

if(QC1_BUILD_H7)
  function(qc1_json_escape output input)
    string(REPLACE "\\" "\\\\" value "${input}")
    string(REPLACE "\"" "\\\"" value "${value}")
    string(REPLACE "\r" "\\r" value "${value}")
    string(REPLACE "\n" "\\n" value "${value}")
    set(${output} "${value}" PARENT_SCOPE)
  endfunction()

  function(qc1_add_h7_core target core)
    set(source_var "QC1_${core}_SOURCES")
    set(include_var "QC1_${core}_INCLUDE_DIRS")
    set(definition_var "QC1_${core}_DEFINITIONS")
    set(option_var "QC1_${core}_COMPILE_OPTIONS")
    set(linker_var "QC1_${core}_LINKER_SCRIPT")
    set(sources "${${source_var}}")
    set(include_dirs "${${include_var}}")
    set(definitions "${${definition_var}}")
    set(compile_options "${${option_var}}")
    set(linker_script "${${linker_var}}")
    if(NOT sources)
      return()
    endif()
    if(NOT linker_script OR NOT EXISTS "${linker_script}")
      message(FATAL_ERROR "QC1 ${core} linker script is missing or ambiguous")
    endif()
    if(NOT compile_options)
      message(FATAL_ERROR "QC1 ${core} CPU/FPU/ABI options were not resolved")
    endif()
    foreach(source IN LISTS sources)
      if(NOT EXISTS "${source}")
        message(FATAL_ERROR "QC1 ${core} source is missing: ${source}")
      endif()
    endforeach()

    set(output_directory "${CMAKE_BINARY_DIR}/${core}")
    file(MAKE_DIRECTORY "${output_directory}")
    add_executable(${target} ${sources})
    set_target_properties(${target} PROPERTIES
      OUTPUT_NAME firmware
      SUFFIX ".elf"
      RUNTIME_OUTPUT_DIRECTORY "${output_directory}"
    )
    target_include_directories(${target} PRIVATE ${include_dirs})
    target_compile_definitions(${target} PRIVATE ${definitions})
    target_compile_options(${target} PRIVATE
      ${compile_options}
      -ffunction-sections
      -fdata-sections
      -fno-common
    )
    target_link_options(${target} PRIVATE
      ${compile_options}
      --specs=nano.specs
      --specs=nosys.specs
      "-T${linker_script}"
      "-Wl,-Map=${output_directory}/firmware.map,--cref"
      -Wl,--gc-sections
      -Wl,--print-memory-usage
      -Wl,--start-group
      -lc
      -lm
      -Wl,--end-group
    )
    add_custom_command(TARGET ${target} POST_BUILD
      COMMAND "${CMAKE_OBJCOPY}" -O ihex "$<TARGET_FILE:${target}>" "${output_directory}/firmware.hex"
      COMMAND "${CMAKE_OBJCOPY}" -O binary -S "$<TARGET_FILE:${target}>" "${output_directory}/firmware.bin"
      COMMAND "${CMAKE_SIZE}" "$<TARGET_FILE:${target}>"
      COMMENT "Generating ${core}/firmware.bin and ${core}/firmware.hex"
    )
    qc1_json_escape(linker_json "${linker_script}")
    qc1_json_escape(output_json "${output_directory}")
    string(REPLACE ";" " " flags_text "${compile_options}")
    qc1_json_escape(flags_json "${flags_text}")
    if(QC1_REPORT_ENTRIES)
      set(report_separator ",\n")
    else()
      set(report_separator "")
    endif()
    set(QC1_REPORT_ENTRIES "${QC1_REPORT_ENTRIES}${report_separator}    {\"core\": \"${core}\", \"target\": \"${target}\", \"elf\": \"$<TARGET_FILE:${target}>\", \"bin\": \"${output_json}/firmware.bin\", \"hex\": \"${output_json}/firmware.hex\", \"map\": \"${output_json}/firmware.map\", \"linkerScript\": \"${linker_json}\", \"compileOptions\": \"${flags_json}\"}" PARENT_SCOPE)
    message(STATUS "QC1 ${core}: ${sources}")
    message(STATUS "QC1 ${core} linker: ${linker_script}")
    message(STATUS "QC1 ${core} flags: ${compile_options}")
  endfunction()

  qc1_add_h7_core(firmware_cm7 CM7)
  qc1_add_h7_core(firmware_cm4 CM4)
  if(NOT TARGET firmware_cm7 AND NOT TARGET firmware_cm4)
    message(FATAL_ERROR "QC1 H7 import has no configured CM7 or CM4 sources")
  endif()
  qc1_json_escape(project_root_json "${QC1_ROOT}")
  file(GENERATE OUTPUT "${CMAKE_BINARY_DIR}/build-report.json" CONTENT "{\n  \"schemaVersion\": 1,\n  \"status\": \"configured\",\n  \"projectRoot\": \"${project_root_json}\",\n  \"artifacts\": [\n${QC1_REPORT_ENTRIES}\n  ]\n}\n")
  message(STATUS "QC1 H7 project root: ${QC1_ROOT}")
  return()
endif()

if(NOT QC1_SOURCE_DIR)
  if(EXISTS "${QC1_ROOT}/Core/Src")
    set(QC1_SOURCE_DIR "${QC1_ROOT}/Core/Src")
  elseif(EXISTS "${QC1_ROOT}/Src")
    set(QC1_SOURCE_DIR "${QC1_ROOT}/Src")
  else()
    message(FATAL_ERROR "QC1_SOURCE_DIR is required for a custom source layout")
  endif()
endif()

file(GLOB_RECURSE QC1_C_SOURCES CONFIGURE_DEPENDS
  "${QC1_SOURCE_DIR}/*.c"
  "${QC1_ROOT}/Core/Src/*.c"
  "${QC1_ROOT}/Drivers/STM32F1xx_HAL_Driver/Src/*.c"
  "${QC1_ROOT}/Middlewares/*.c"
  "${QC1_ROOT}/USB_DEVICE/*.c"
  "${QC1_ROOT}/App/*.c"
  "${QC1_ROOT}/Src/*.c"
)
list(FILTER QC1_C_SOURCES EXCLUDE REGEX "/Templates(_LL)?/")

if(QC1_STARTUP AND EXISTS "${QC1_STARTUP}")
  set(QC1_STARTUP_SOURCES "${QC1_STARTUP}")
else()
  file(GLOB QC1_STARTUP_SOURCES CONFIGURE_DEPENDS
    "${QC1_ROOT}/Core/Startup/startup_stm32f103*.s"
    "${QC1_ROOT}/Core/Startup/startup_stm32f103*.S"
    "${QC1_ROOT}/Src/startup_stm32f103*.s"
    "${QC1_ROOT}/Src/startup_stm32f103*.S"
    "${QC1_ROOT}/startup_stm32f103*.s"
    "${QC1_ROOT}/startup_stm32f103*.S"
  )
endif()

if(QC1_LINKER_SCRIPT AND EXISTS "${QC1_LINKER_SCRIPT}")
  set(QC1_LINKER_SCRIPTS "${QC1_LINKER_SCRIPT}")
else()
  file(GLOB QC1_LINKER_SCRIPTS CONFIGURE_DEPENDS "${QC1_ROOT}/*.ld")
endif()

list(LENGTH QC1_C_SOURCES QC1_C_SOURCE_COUNT)
list(LENGTH QC1_STARTUP_SOURCES QC1_STARTUP_COUNT)
list(LENGTH QC1_LINKER_SCRIPTS QC1_LINKER_COUNT)
if(QC1_C_SOURCE_COUNT EQUAL 0)
  message(FATAL_ERROR "No C sources found in the STM32 project")
endif()
if(QC1_STARTUP_COUNT EQUAL 0)
  message(FATAL_ERROR "No STM32F1 startup assembly file found")
endif()
if(QC1_LINKER_COUNT EQUAL 0)
  message(FATAL_ERROR "No linker script (*.ld) found")
endif()

list(GET QC1_STARTUP_SOURCES 0 QC1_STARTUP)
list(GET QC1_LINKER_SCRIPTS 0 QC1_LINKER_SCRIPT)
get_filename_component(QC1_STARTUP_NAME "${QC1_STARTUP}" NAME)
string(TOLOWER "${QC1_STARTUP_NAME}" QC1_STARTUP_LOWER)

if(QC1_STARTUP_LOWER MATCHES "stm32f103x6")
  set(QC1_DEVICE_DEFINE STM32F103x6)
elseif(QC1_STARTUP_LOWER MATCHES "stm32f103x[bc]")
  set(QC1_DEVICE_DEFINE STM32F103xB)
elseif(QC1_STARTUP_LOWER MATCHES "stm32f103x[de]")
  set(QC1_DEVICE_DEFINE STM32F103xE)
elseif(QC1_STARTUP_LOWER MATCHES "stm32f103x[fg]")
  set(QC1_DEVICE_DEFINE STM32F103xG)
else()
  set(QC1_DEVICE_DEFINE STM32F103xB)
  message(WARNING "Unknown STM32F103 density in ${QC1_STARTUP_NAME}; using STM32F103xB")
endif()

file(GLOB_RECURSE QC1_HEADERS CONFIGURE_DEPENDS
  "${QC1_ROOT}/*.h"
  "${QC1_ROOT}/Core/*.h"
  "${QC1_ROOT}/Drivers/*.h"
  "${QC1_ROOT}/Middlewares/*.h"
  "${QC1_ROOT}/USB_DEVICE/*.h"
  "${QC1_ROOT}/App/*.h"
  "${QC1_ROOT}/Inc/*.h"
)
list(FILTER QC1_HEADERS EXCLUDE REGEX "/(build|out|node_modules|\\.git|cache)/")
set(QC1_INCLUDE_DIRS "${QC1_ROOT}/Core/Inc" "${QC1_ROOT}/Inc")
foreach(QC1_HEADER IN LISTS QC1_HEADERS)
  get_filename_component(QC1_HEADER_DIR "${QC1_HEADER}" DIRECTORY)
  list(APPEND QC1_INCLUDE_DIRS "${QC1_HEADER_DIR}")
endforeach()
list(REMOVE_DUPLICATES QC1_INCLUDE_DIRS)

add_executable(firmware ${QC1_C_SOURCES} "${QC1_STARTUP}")
set_target_properties(firmware PROPERTIES OUTPUT_NAME firmware SUFFIX ".elf")

target_include_directories(firmware PRIVATE ${QC1_INCLUDE_DIRS})
target_compile_definitions(firmware PRIVATE ${QC1_DEVICE_DEFINE})
if(EXISTS "${QC1_ROOT}/Drivers/STM32F1xx_HAL_Driver")
  target_compile_definitions(firmware PRIVATE USE_HAL_DRIVER)
endif()
target_compile_options(firmware PRIVATE
  -mcpu=cortex-m3
  -mthumb
  -mfloat-abi=soft
  -ffunction-sections
  -fdata-sections
  $<$<COMPILE_LANGUAGE:C>:-Wall;-Wextra;-Wno-unused-parameter>
  $<$<COMPILE_LANGUAGE:ASM>:-x;assembler-with-cpp>
)
target_link_options(firmware PRIVATE
  -mcpu=cortex-m3
  -mthumb
  -mfloat-abi=soft
  --specs=nano.specs
  --specs=nosys.specs
  "-T${QC1_LINKER_SCRIPT}"
  "-Wl,-Map=${CMAKE_BINARY_DIR}/firmware.map,--cref"
  -Wl,--gc-sections
  -Wl,--start-group
  -lc
  -lm
  -Wl,--end-group
)

add_custom_command(TARGET firmware POST_BUILD
  COMMAND "${CMAKE_OBJCOPY}" -O ihex "$<TARGET_FILE:firmware>" "${CMAKE_BINARY_DIR}/firmware.hex"
  COMMAND "${CMAKE_OBJCOPY}" -O binary -S "$<TARGET_FILE:firmware>" "${CMAKE_BINARY_DIR}/firmware.bin"
  COMMAND "${CMAKE_SIZE}" "$<TARGET_FILE:firmware>"
  COMMENT "Generating firmware.hex and firmware.bin"
)

if(QC1_OPENOCD AND EXISTS "${QC1_OPENOCD}")
  add_custom_target(flash
    COMMAND "${QC1_OPENOCD}"
      -f interface/stlink.cfg
      -f target/stm32f1x.cfg
      -c "program $<TARGET_FILE:firmware> verify reset exit"
    DEPENDS firmware
    USES_TERMINAL
  )
elseif(QC1_STFLASH AND EXISTS "${QC1_STFLASH}")
  add_custom_target(flash
    COMMAND "${QC1_STFLASH}" --reset write "${CMAKE_BINARY_DIR}/firmware.bin" 0x08000000
    DEPENDS firmware
    USES_TERMINAL
  )
else()
  message(STATUS "Flash target disabled: OpenOCD and st-flash were not found")
endif()

message(STATUS "QC1 project: ${QC1_ROOT}")
message(STATUS "QC1 startup: ${QC1_STARTUP}")
message(STATUS "QC1 linker: ${QC1_LINKER_SCRIPT}")
message(STATUS "QC1 device define: ${QC1_DEVICE_DEFINE}")
