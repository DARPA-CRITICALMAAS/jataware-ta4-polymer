# Bulk upload script

  

This script folder has been created to bulk upload USGS maps into the Jataware auto_georef application. It attempts to save a cog version of the maps along with a few best guess projection files that are created using GCPs extracted by the jataware_gcp_extractor model.

  

To run the process is pretty simple. Since the bulk script needs access to gdal and other python libraries used in the nylon_georef:dev docker container it is easiest to run the script from that container.

  

Make sure the .env files are set correctly in the auto-georef/.env file. That will be used in the scripts for connecting to es and s3.

  

Next run the docker container. Make sure to pass in aws creds and known_hosts file since we will need to connect to an rsync server. You might need to ssh into that rsync server before running this script so the known_host file is populated correctly.
```
docker run -v $(pwd):/home/apps/auto-georef -v /home/kyle/.aws/credentials:/home/apps/.aws/credentials -v /home/kyle/.ssh/known_hosts:/home/apps/.ssh/known_hosts -p 3000:3000 nylon_georef:dev
```
  Ok now that is running we can exec into that container.
  ```
  docker ps
  docker exec -it 4b23300d8492 /bin/bash
  ```
  Now we need to create our new indexes in ES.
  ```
  cd scripts/
  python create_elasticsearch_indexes2.py
  ```
  This will create new indexes to populate.
  Now we can run the bulk_georef2.py script to update our data, generate new map_ids, extract gcps, produce projected geotifs and save all info in ES and files in s3.
  We will run this as a python module. Logs will be in the logs folder. A new log file will be generated every time you run the script with a prefix of bulk_upload followed by a uuid. This will take a while to complete.
  ```
  cd ..
  python -m scripts.bulk_georef2
  ```
Now we should have our new ES indexes updated and our s3 files saved correctly. 
Next we are going to run another script called capture_original_crs_info.sh
This will read in the original georeferenced files from ngmdb and save those as projection files along with the gcps used. We will have to generate the map_id from the tif so we can match it to the map_ids we already have in ES.
This is where will will be connecting to rsync server so make sure we have the ssh known_host set up correctly.
```
cd scripts
/bin/bash capture_original_crs_info.sh
```
