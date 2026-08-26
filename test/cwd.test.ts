import { expect, test } from "bun:test"
import { harnessCwdFor, isPosixAbsolute, isWin32Absolute, win32ToWsl, wslToWin32 } from "../src/harness/cwd"

test("win32ToWsl converts a drive path to the WSL automount form", () => {
  expect(win32ToWsl(`D:\\Users\\Seahi\\Desktop\\serial-debbuger-tauri`)).toBe(
    "/mnt/d/Users/Seahi/Desktop/serial-debbuger-tauri",
  )
  expect(win32ToWsl("C:\\Work\\src")).toBe("/mnt/c/Work/src")
  expect(win32ToWsl("d:/x/y")).toBe("/mnt/d/x/y")
})

test("wslToWin32 converts a /mnt mount back to a drive path", () => {
  expect(wslToWin32("/mnt/d/Users/Seahi/Desktop")).toBe(`D:\\Users\\Seahi\\Desktop`)
  expect(wslToWin32("/mnt/c/Work/src")).toBe(`C:\\Work\\src`)
})

test("path-style predicates", () => {
  expect(isWin32Absolute(`D:\\Users\\Seahi`)).toBe(true)
  expect(isWin32Absolute("D:/Users/Seahi")).toBe(true)
  expect(isWin32Absolute("/mnt/d/Users")).toBe(false)
  expect(isPosixAbsolute("/mnt/d/Users")).toBe(true)
  expect(isPosixAbsolute(`D:\\Users`)).toBe(false)
})

test("harnessCwdFor leaves same-style paths untouched", () => {
  expect(harnessCwdFor("/home/seahi/proj", "/home/seahi/proj")).toBe("/home/seahi/proj")
  expect(harnessCwdFor(`D:\\Users\\Seahi`, `C:\\Users`)).toBe(`D:\\Users\\Seahi`)
  expect(harnessCwdFor("/mnt/d/proj", undefined)).toBe("/mnt/d/proj")
})

test("harnessCwdFor bridges a Windows client to a POSIX (WSL) harness", () => {
  expect(
    harnessCwdFor(`D:\\Users\\Seahi\\Desktop\\serial-debbuger-tauri`, "/mnt/d/Users/Seahi/Desktop/serial-debbuger-tauri"),
  ).toBe("/mnt/d/Users/Seahi/Desktop/serial-debbuger-tauri")
  expect(harnessCwdFor(`D:\\Users\\Seahi`, "/home/seahi")).toBe("/mnt/d/Users/Seahi")
})

test("harnessCwdFor bridges a WSL client to a Windows harness only for /mnt mounts", () => {
  expect(harnessCwdFor("/mnt/d/Users/Seahi", `D:\\Users\\Seahi`)).toBe(`D:\\Users\\Seahi`)
  expect(harnessCwdFor("/home/seahi/proj", `D:\\Users\\Seahi`)).toBe("/home/seahi/proj")
})
