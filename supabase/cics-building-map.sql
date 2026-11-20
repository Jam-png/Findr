-- Findr: replace the original illustrative sample rooms with the supplied CICS Building Map directory.
-- Run once in Supabase SQL Editor after schema.sql.
-- This removes only the placeholder rows inserted by the starter schema.
-- Existing reports linked to those placeholder rows will keep their report records, but room_id becomes NULL.

delete from public.rooms r
using public.floors f, public.buildings b
where r.floor_id = f.id
  and f.building_id = b.id
  and b.building_name = 'CICS Building'
  and r.room_number in ('OFF-1', 'LAB-1', '301', 'FAC-3');

insert into public.rooms (floor_id, room_name, room_number, room_type, description)
select f.id, x.room_name, x.room_number, x.room_type, x.description
from public.floors f
join public.buildings b on b.id = f.building_id
join (values
  -- First floor
  (1, 'Room 101', '101', 'Classroom', 'Room 101'),
  (1, 'Room 102', '102', 'Classroom', 'Room 102'),
  (1, 'Room 103', '103', 'Classroom', 'Room 103'),
  (1, 'Room 104', '104', 'Classroom', 'Room 104'),
  (1, 'Room 105', '105', 'Classroom', 'Room 105'),
  (1, 'Room 106', '106', 'Classroom', 'Room 106'),
  (1, 'CICS Orgs Office', 'ORGS-OFFICE', 'Office', 'CICS Organizations Office'),
  (1, 'Utility Room', 'UTILITY', 'Facility', 'Utility Room'),
  (1, 'Women''s Toilet', 'WOMENS-TOILET', 'Restroom', 'Women''s Toilet'),
  (1, 'Faculty Toilet', 'FACULTY-TOILET', 'Restroom', 'Faculty Toilet'),

  -- Second floor
  (2, 'Room 201', '201', 'Classroom', 'Room 201'),
  (2, 'Room 202', '202', 'Classroom', 'Room 202'),
  (2, 'CPE Faculty', 'A', 'Office', 'CPE Faculty'),
  (2, 'CICS Student Services', 'B', 'Office', 'CICS Student Services'),
  (2, 'Consultation Office', 'C', 'Office', 'Consultation Office'),
  (2, 'CICS Faculty', 'D', 'Office', 'CICS Faculty'),
  (2, 'Dean''s Office', 'E', 'Office', 'Dean''s Office'),
  (2, 'Faculty Toilet', 'FACULTY-TOILET', 'Restroom', 'Faculty Toilet'),

  -- Third floor
  (3, 'Lab 1', 'LAB1', 'Laboratory', 'Laboratory 1'),
  (3, 'Lab 2', 'LAB2', 'Laboratory', 'Laboratory 2'),
  (3, 'Lab 3', 'LAB3', 'Laboratory', 'Laboratory 3'),
  (3, 'Lab 4', 'LAB4', 'Laboratory', 'Laboratory 4'),
  (3, 'Lab 5', 'LAB5', 'Laboratory', 'Laboratory 5'),
  (3, 'Lab 6', 'LAB6', 'Laboratory', 'Laboratory 6'),
  (3, 'Women''s Toilet', 'WOMENS-TOILET', 'Restroom', 'Women''s Toilet'),
  (3, 'Men''s Toilet', 'MENS-TOILET', 'Restroom', 'Men''s Toilet'),

  -- Fourth floor
  (4, 'Room 401', '401', 'Classroom', 'Room 401'),
  (4, 'Room 402', '402', 'Classroom', 'Room 402'),
  (4, 'Physics Lab', 'PHYSICS-LAB', 'Laboratory', 'Physics Laboratory'),
  (4, 'Smart Classroom', 'SMART-CLASSROOM', 'Classroom', 'Smart Classroom'),
  (4, 'Tech Lab', 'TECH-LAB', 'Laboratory', 'Technology Laboratory'),
  (4, 'ITL', 'ITL', 'Laboratory', 'ITL'),

  -- Fifth floor
  (5, 'Room 501', '501', 'Classroom', 'Room 501'),
  (5, 'Room 502', '502', 'Classroom', 'Room 502'),
  (5, 'Room 503', '503', 'Classroom', 'Room 503'),
  (5, 'Room 504', '504', 'Classroom', 'Room 504'),
  (5, 'Room 505', '505', 'Classroom', 'Room 505'),
  (5, 'Room 506', '506', 'Classroom', 'Room 506')
) as x(floor_number, room_name, room_number, room_type, description)
  on x.floor_number = f.floor_number
where b.building_name = 'CICS Building'
on conflict (floor_id, room_number) do update
set room_name = excluded.room_name,
    room_type = excluded.room_type,
    description = excluded.description;
