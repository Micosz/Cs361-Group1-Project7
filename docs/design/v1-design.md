# Version 1 Main Design

## Overview

หน้า Browse ออกแบบสำหรับผู้ใช้ทั่วไปที่ไม่ต้องเข้าสู่ระบบ เพื่อให้ผู้ใช้เข้าใจจุดประสงค์ของเว็บไซต์ เรียกดูข้อมูลคู่ความร่วมมือ ความร่วมมือ และกิจกรรมที่กำหนดให้เผยแพร่ และเลือกเปิดรายละเอียดของรายการที่สนใจได้ เอกสารนี้บันทึกเฉพาะการออกแบบหน้าหลัก ส่วนโครงสร้างและการตรวจสอบข้อมูลบันทึกแยกไว้ใน `docs/data/v1-data.md`

## Page Structure and Components

หน้าหลักประกอบด้วย Header, Navigation, Main Content และ Footer โดย Main Content มีส่วนแนะนำเว็บไซต์และส่วนแสดงรายการข้อมูลผ่าน Reusable Card Component แต่ละ Card แสดงชื่อหรือหัวข้อ ประเภทหรือหมวดหมู่ คำอธิบายแบบสั้น

## User Flow

1. ผู้ใช้ทั่วไปเปิดหน้า Browse โดยไม่ต้อง Login
2. ผู้ใช้ดู Card ของคู่ความร่วมมือ ความร่วมมือ หรือกิจกรรมที่กำหนดให้เผยแพร่
3. ผู้ใช้เลือก Card เพื่อเปิดหน้ารายละเอียด
4. ระบบส่ง Path หรือ Identifier ของรายการที่เลือกและแสดงหน้ารายละเอียดที่ตรงกับรายการนั้น

## Responsive Design

หน้า Browse ต้องใช้งานได้ทั้ง Desktop และ Mobile โดย Header, Navigation, Main Content, Card Container และ Footer ต้องปรับตามขนาดหน้าจอ Card ต้องแสดงข้อมูลหลักและ Action ได้ครบ

## Figma Design

- Figma กลางของทีม: `https://www.figma.com/design/iHDqhVZUCciTG8QHfQ0dkG/SuperCloud?node-id=0-1&p=f&t=w2z4LQfZQovbg7oY-0`